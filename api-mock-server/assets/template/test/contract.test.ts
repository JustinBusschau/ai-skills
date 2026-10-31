// Checks the contract layer and state discovery against small inline specs, so they are
// tested independently of whatever API this mock was built for.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Contract } from '../src/core/contract.ts';
import { bodyProves, stateValues } from '../src/core/states.ts';
import { FILES, parseCookies, parseForm, parseMultipart } from '../src/core/util.ts';
import { contentTypeOf, encodeBody } from './helpers.ts';

async function contractFor(yaml: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'spec-')), 'openapi.yaml');
  writeFileSync(file, yaml);
  return Contract.load(file, '');
}

describe('form-encoded request bodies', () => {
  it('are validated, with fields coerced to their schema types', async () => {
    const c = await contractFor(`openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /token:
    post:
      operationId: token
      requestBody:
        required: true
        content:
          application/x-www-form-urlencoded:
            schema:
              type: object
              required: [grant_type, client_id]
              properties:
                grant_type: { type: string, enum: [client_credentials] }
                client_id: { type: string }
                expires_in: { type: integer }
      responses: { '200': { description: ok } }
`);
    const op = c.getOperation('token')!;
    const input = (body: unknown) => ({ params: {}, query: {}, headers: {}, cookies: {}, body, contentType: 'application/x-www-form-urlencoded' });
    const bad = c.validateRequest(op, input({ grant_type: 'password' }));
    expect(bad.problems.length).toBeGreaterThan(0);
    const good = c.validateRequest(op, input({ grant_type: 'client_credentials', client_id: 'abc', expires_in: '60' }));
    expect(good.problems).toEqual([]);
    expect((good.body as { expires_in: unknown }).expires_in).toBe(60);
  });
});

describe('state discovery', () => {
  it('finds every value of oneOf consts, anyOf of several enums, and arrays of enums', async () => {
    const c = await contractFor(`openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /x:
    post:
      operationId: x
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Decision' } } } }
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { type: object, properties: { r: { $ref: '#/components/schemas/Refund' }, o: { $ref: '#/components/schemas/Order' } } } } }
components:
  schemas:
    Decision: { type: object, properties: { status: { enum: [accept, decline] } } }
    OpenStates: { type: string, enum: [new, picking] }
    ClosedStates: { type: string, enum: [shipped, cancelled] }
    Refund:
      type: object
      properties:
        status: { oneOf: [ { const: requested }, { const: approved }, { const: paid } ] }
    Order:
      type: object
      properties:
        state: { anyOf: [ { $ref: '#/components/schemas/OpenStates' }, { $ref: '#/components/schemas/ClosedStates' } ] }
        phase: { type: array, items: { enum: [a, b] } }
        fulfilment: { type: object, additionalProperties: { type: object, properties: { status: { enum: [packed] } } } }
`);
    const labels = stateValues(c).map((s) => s.label).sort();
    expect(labels).toEqual(
      [
        'Order.fulfilment.*.status=packed',
        'Order.phase=a',
        'Order.phase=b',
        'Order.state=cancelled',
        'Order.state=new',
        'Order.state=picking',
        'Order.state=shipped',
        'Refund.status=approved',
        'Refund.status=paid',
        'Refund.status=requested',
      ].sort(),
    );
    expect(bodyProves(c, { orders: [{ phase: ['b'] }] }, 'Order.phase=b')).toBe(true);
  });

  it('does not let another resource prove a label when the schema lists its properties', async () => {
    const c = await contractFor(`openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /p:
    get:
      operationId: p
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Payment' } } } } }
components:
  schemas:
    Payment:
      type: object
      properties: { id: { type: string }, status: { type: string, enum: [pending] } }
`);
    expect(bodyProves(c, { id: 'p1', status: 'pending' }, 'Payment.status=pending')).toBe(true);
    expect(bodyProves(c, { id: 'kyc_1', status: 'pending', level: 2 }, 'Payment.status=pending')).toBe(false);
  });
});

describe('request parsing', () => {
  it('keeps every value of a repeated form field', () => {
    expect(parseForm('scope=a&scope=b&client_id=x')).toEqual({ scope: ['a', 'b'], client_id: 'x' });
  });

  it('encodes form scenario bodies as form fields, repeating arrays', () => {
    const body = encodeBody({ method: 'POST', path: '/t', contentType: 'application/x-www-form-urlencoded', body: { scope: ['a', 'b'], id: 1 } });
    expect(body).toBe('scope=a&scope=b&id=1');
  });

  it('survives a malformed cookie set by some other app', () => {
    expect(parseCookies('x=%E0%A4%A; ok=1')).toEqual({ x: '%E0%A4%A', ok: '1' });
  });
});

describe('multipart bodies', () => {
  it('parse JSON parts as objects and files as markers with their details', async () => {
    const r = {
      method: 'POST',
      path: '/x',
      contentType: 'multipart/form-data' as const,
      body: { metadata: { documentType: 'OTHER' }, note: 'hi', file: { $file: { filename: 'a.pdf', contentType: 'application/pdf', content: '%PDF-1.4' } } },
    };
    const parsed = await parseMultipart(Buffer.from(encodeBody(r)!), contentTypeOf(r));
    expect(parsed.metadata).toEqual({ documentType: 'OTHER' });
    expect(parsed.note).toBe('hi');
    expect(parsed.file).toMatch(/^\[file a\.pdf, 8 bytes, application\/pdf\]$/);
    expect((parsed as Record<symbol, unknown>)[FILES]).toEqual({ file: { filename: 'a.pdf', contentType: 'application/pdf', size: 8 } });
  });
});

describe('OpenAPI 3.0 nullability', () => {
  it('lets a nullable allOf or $ref schema be null, and still validates it when present', async () => {
    const c = await contractFor(`openapi: 3.0.3
info: { title: T, version: '1' }
paths:
  /s:
    get:
      operationId: s
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [offer]
                properties:
                  offer: { type: object, allOf: [ { $ref: '#/components/schemas/Offer' } ], nullable: true }
components:
  schemas:
    Offer: { type: object, required: [amount], properties: { amount: { type: integer } } }
`);
    const op = c.getOperation('s')!;
    expect(c.validateResponse(op, 200, { offer: null })).toEqual([]);
    expect(c.validateResponse(op, 200, { offer: { amount: 5 } })).toEqual([]);
    expect(c.validateResponse(op, 200, { offer: { amount: 'x' } }).length).toBeGreaterThan(0);
  });
});
