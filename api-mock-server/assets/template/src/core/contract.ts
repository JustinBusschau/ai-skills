// The OpenAPI contract: loading, routing, and validation for OpenAPI 3.0 and 3.1.
//
// The spec is bundled into one document (external $refs inlined) and checked with
// @readme/openapi-parser. Schemas are validated with Ajv against JSON pointers into
// that document, so internal and circular $refs resolve natively: draft-07 Ajv for
// 3.0 (with 3.0's nullable and boolean exclusiveMinimum/Maximum normalised) and
// Ajv's 2020-12 mode for 3.1. Requests and responses use separate copies of the
// document so readOnly properties are not required in requests and writeOnly
// properties are not required in responses.
import { readFileSync } from 'node:fs';
import { bundle, validate } from '@readme/openapi-parser';
import AjvDraft7, { type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { sample } from 'openapi-sampler';
import { parse } from 'yaml';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type AjvInstance = InstanceType<typeof AjvDraft7.default>;

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

export interface ParamInfo {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  /** JSON pointer to the parameter's schema, if it has one. */
  schemaPointer?: string;
  isArray: boolean;
  explode: boolean;
}

export interface OperationInfo {
  operationId: string;
  /** JSON pointer to the operation object in the bundled document. */
  pointer: string;
  method: string;
  path: string;
  parameters: ParamInfo[];
  requestBody?: { required: boolean; media: Record<string, string | undefined> };
  /** Response key ("200", "4XX", "default") -> JSON pointer to the resolved response object. */
  responses: Record<string, string>;
  secured: boolean;
  regex: RegExp;
  pathParamNames: string[];
  literalSegments: number;
}

export interface ContractProblem {
  where: string;
  message: string;
  detail?: unknown;
}

export interface RequestInput {
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, string>;
  body: unknown;
  contentType?: string;
}

/** Marker for a body that claimed to be JSON but did not parse. */
export class MalformedBody {
  constructor(readonly raw: string, readonly error: string) {}
}

export const isFormMedia = (media: string) => /^(application\/x-www-form-urlencoded|multipart\/form-data)$/i.test(media);

export const isJsonMedia = (media: string) => /^application\/(?:[\w.+-]+\+)?json$/i.test(media) || media === '*/*';

export class Contract {
  readonly operations: OperationInfo[] = [];
  readonly version: '3.0' | '3.1';
  readonly documentProblems: string[];
  /** The document as written (bundled but not normalised), for serving to clients. */
  readonly source: Json;
  private byId = new Map<string, OperationInfo>();
  private validators = new Map<string, ValidateFunction>();
  private ajvRequest: AjvInstance;
  private ajvResponse: AjvInstance;
  private ajvParams: AjvInstance;

  private constructor(
    readonly doc: Json,
    readonly basePath: string,
    documentProblems: string[],
  ) {
    this.documentProblems = documentProblems;
    this.version = String(doc.openapi).startsWith('3.1') ? '3.1' : '3.0';
    this.source = structuredClone(doc);
    if (this.version === '3.0') normalise30(doc);
    const make = (opts: Record<string, unknown>) => {
      const Ctor = (this.version === '3.1' ? Ajv2020.default : AjvDraft7.default) as typeof AjvDraft7.default;
      const ajv = new Ctor({ strict: false, allErrors: true, validateSchema: false, ...opts });
      addFormats.default(ajv);
      return ajv;
    };
    this.ajvRequest = make({});
    this.ajvRequest.addSchema(withoutRequiredFlag(doc, 'readOnly'), 'spec');
    this.ajvResponse = make({});
    this.ajvResponse.addSchema(withoutRequiredFlag(doc, 'writeOnly'), 'spec');
    this.ajvParams = make({ coerceTypes: 'array' });
    this.ajvParams.addSchema(withoutRequiredFlag(doc, 'readOnly'), 'spec');
    this.index();
  }

  static async load(specPath: string, basePath: string): Promise<Contract> {
    const raw = parse(readFileSync(specPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !String(raw.openapi ?? '').startsWith('3.')) {
      throw new Error(
        `${specPath} is not an OpenAPI 3.x document${raw?.swagger ? ' (it is Swagger 2.0; convert it first, e.g. npx swagger2openapi)' : ''}.`,
      );
    }
    // Bundling from the file path lets external $refs resolve relative to the spec.
    const bundled = (await bundle(specPath)) as Json;
    const result = await validate(structuredClone(bundled));
    const problems = result.valid
      ? []
      : ((result as { errors?: { message: string }[] }).errors ?? []).map((e) => e.message.split('\n')[0] ?? String(e));
    return new Contract(bundled, basePath, problems);
  }

  getOperation(id: string): OperationInfo | undefined {
    return this.byId.get(id);
  }

  /** Find the operation for a request path (query string removed) and method. */
  match(method: string, rawPath: string): { op: OperationInfo; params: Record<string, string> } | 'not_found' | 'method_not_allowed' {
    let path = rawPath.split('?')[0] ?? '/';
    if (this.basePath) {
      if (path !== this.basePath && !path.startsWith(`${this.basePath}/`)) return 'not_found';
      path = path.slice(this.basePath.length) || '/';
    }
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    let pathMatched = false;
    for (const op of this.operations) {
      const m = op.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      const wanted = method.toUpperCase();
      // HEAD is answered by the GET operation unless the spec defines HEAD itself.
      const headViaGet = wanted === 'HEAD' && op.method === 'GET' && !this.operations.some((o) => o.method === 'HEAD' && o.regex.test(path));
      if (op.method !== wanted && !headViaGet) continue;
      const params: Record<string, string> = {};
      op.pathParamNames.forEach((name, i) => {
        params[name] = safeDecode(m[i + 1] ?? '');
      });
      return { op, params };
    }
    return pathMatched ? 'method_not_allowed' : 'not_found';
  }

  /** Validate and coerce a request. Returns problems plus coerced params and query. */
  validateRequest(op: OperationInfo, input: RequestInput) {
    const problems: ContractProblem[] = [];
    const params: Record<string, unknown> = { ...input.params };
    const query: Record<string, unknown> = { ...input.query };
    const headers: Record<string, unknown> = {};
    const cookies: Record<string, unknown> = { ...input.cookies };
    let coercedBody: unknown = input.body;
    for (const p of op.parameters) {
      const source = p.in === 'path' ? params : p.in === 'query' ? query : p.in === 'header' ? headers : cookies;
      let value: unknown = p.in === 'header' ? input.headers[p.name.toLowerCase()] : source[p.name];
      if (value === undefined || value === '') {
        if (p.required) problems.push({ where: `${p.in}.${p.name}`, message: 'is required' });
        continue;
      }
      if (p.isArray && typeof value === 'string' && !p.explode) value = value.split(',');
      if (p.schemaPointer) {
        const holder = { v: value };
        const v = this.validator(this.ajvParams, `params:${p.schemaPointer}`, {
          type: 'object',
          properties: { v: { $ref: `spec${p.schemaPointer}` } },
        });
        if (!v(holder)) problems.push(...ajvProblems(`${p.in}.${p.name}`, v.errors, true));
        value = holder.v;
      }
      source[p.name] = value;
    }
    if (op.requestBody) {
      const body = input.body;
      if (body === undefined || body === '') {
        if (op.requestBody.required) problems.push({ where: 'body', message: 'request body is required' });
      } else if (body instanceof MalformedBody) {
        problems.push({ where: 'body', message: `malformed JSON: ${body.error}` });
      } else {
        const media = pickMedia(Object.keys(op.requestBody.media), input.contentType);
        if (!media) {
          problems.push({ where: 'body', message: `content type ${input.contentType ?? '(none)'} is not accepted; expected ${Object.keys(op.requestBody.media).join(', ')}` });
        } else {
          const ptr = op.requestBody.media[media];
          if (ptr && isFormMedia(media) && body && typeof body === 'object') {
            // Form fields arrive as strings; coerce them to the schema's types (as for
            // query parameters), and hand the coerced values to the handler.
            const holder = { v: body };
            const v = this.validator(this.ajvParams, `params:${ptr}`, { type: 'object', properties: { v: { $ref: `spec${ptr}` } } });
            if (!v(holder)) problems.push(...ajvProblems('body', v.errors, true));
            coercedBody = holder.v;
          } else if (ptr && (isJsonMedia(media) || typeof body === 'string')) {
            const v = this.validator(this.ajvRequest, `req:${ptr}`, { $ref: `spec${ptr}` });
            if (!v(body)) problems.push(...ajvProblems('body', v.errors));
          }
        }
      }
    }
    return { problems, params, query, cookies, body: coercedBody };
  }

  /** The response key that documents a status: exact, then range (4XX), then default. */
  responseKey(op: OperationInfo, status: number): string | undefined {
    const keys = Object.keys(op.responses);
    const exact = keys.find((k) => k === String(status));
    if (exact) return exact;
    const range = keys.find((k) => k.toUpperCase() === `${Math.floor(status / 100)}XX`);
    if (range) return range;
    return keys.includes('default') ? 'default' : undefined;
  }

  /** Every response header the spec documents (lower case), so browsers can be allowed to read them. */
  documentedResponseHeaders(): string[] {
    const names = new Set<string>();
    for (const op of this.operations) {
      for (const ptr of Object.values(op.responses)) {
        for (const name of Object.keys((getPointer(this.doc, ptr) as Json)?.headers ?? {})) names.add(name.toLowerCase());
      }
    }
    return [...names];
  }

  validateResponse(op: OperationInfo, status: number, body: unknown, headers: Record<string, string> = {}): ContractProblem[] {
    const key = this.responseKey(op, status);
    if (!key) return [{ where: 'status', message: `${status} is not documented for ${op.operationId}` }];
    const ptr = op.responses[key]!;
    const res = getPointer(this.doc, ptr) ?? {};
    const problems: ContractProblem[] = [];
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const content: Record<string, Json> = res.content ?? {};
    const mediaKeys = Object.keys(content);
    if (body !== undefined && status !== 204) {
      if (!mediaKeys.length) {
        problems.push({ where: 'body', message: `response ${key} documents no body` });
      } else {
        const media = pickMedia(mediaKeys, lower['content-type'] ?? 'application/json') ?? mediaKeys[0]!;
        const schemaPtr = content[media]?.schema ? `${ptr}/content/${escapePointer(media)}/schema` : undefined;
        if (schemaPtr && (isJsonMedia(media) || typeof body === 'string')) {
          const v = this.validator(this.ajvResponse, `res:${schemaPtr}`, { $ref: `spec${schemaPtr}` });
          if (!v(body)) problems.push(...ajvProblems('body', v.errors));
        }
      }
    } else if (body === undefined && status !== 204 && mediaKeys.some((m) => content[m]?.schema)) {
      problems.push({ where: 'body', message: `response ${key} documents a body but none was returned` });
    }
    for (const [name, hdr] of Object.entries<Json>(res.headers ?? {})) {
      const h = this.resolve(hdr, `${ptr}/headers/${escapePointer(name)}`);
      if (name.toLowerCase() === 'content-type') continue;
      const value = lower[name.toLowerCase()];
      if (value === undefined) {
        if (h.obj?.required) problems.push({ where: `header.${name}`, message: 'required response header is missing' });
        continue;
      }
      if (h.obj?.schema) {
        const holder = { v: value };
        const v = this.validator(this.ajvParams, `params:${h.pointer}/schema`, {
          type: 'object',
          properties: { v: { $ref: `spec${h.pointer}/schema` } },
        });
        if (!v(holder)) problems.push(...ajvProblems(`header.${name}`, v.errors, true));
      }
    }
    return problems;
  }

  /** The spec's own example (or a sample generated from the schema) for a status. */
  example(op: OperationInfo, status?: number): { status: number; body: unknown } | undefined {
    const keys = Object.keys(op.responses);
    const key = status !== undefined ? this.responseKey(op, status) : (keys.filter((k) => /^2/.test(k)).sort()[0] ?? keys.sort()[0]);
    if (!key) return undefined;
    const code = status ?? (/^\d{3}$/.test(key) ? Number(key) : /^\dXX$/i.test(key) ? Number(key[0]) * 100 : 200);
    const res = getPointer(this.doc, op.responses[key]!) ?? {};
    const content: Record<string, Json> = res.content ?? {};
    const media = Object.keys(content).find(isJsonMedia) ?? Object.keys(content)[0];
    if (!media) return { status: code, body: undefined };
    const m = content[media] ?? {};
    if (m.example !== undefined) return { status: code, body: m.example };
    const first = m.examples ? Object.values<Json>(m.examples)[0] : undefined;
    if (first) return { status: code, body: this.resolve(first, '').obj?.value };
    if (!m.schema) return { status: code, body: undefined };
    return { status: code, body: sample(m.schema, { skipWriteOnly: true }, this.doc) };
  }

  /**
   * Request-body schema pointer for a webhook: an OpenAPI 3.1 `webhooks` entry by
   * name, or (for 3.0 specs that document webhooks as paths) an operationId.
   */
  webhookSchemaPointer(ref: string): string | undefined {
    const item = this.doc.webhooks?.[ref];
    if (item) {
      for (const m of METHODS) {
        if (!item[m]) continue;
        const rb = this.resolve(item[m].requestBody, `#/webhooks/${escapePointer(ref)}/${m}/requestBody`);
        const media = Object.keys(rb.obj?.content ?? {}).find(isJsonMedia);
        if (media && rb.obj.content[media].schema) return `${rb.pointer}/content/${escapePointer(media)}/schema`;
      }
      return undefined;
    }
    const op = this.getOperation(ref);
    if (!op?.requestBody) return undefined;
    const media = Object.keys(op.requestBody.media).find(isJsonMedia);
    return media ? op.requestBody.media[media] : undefined;
  }

  validateWebhook(schemaPointer: string, payload: unknown): ContractProblem[] {
    const v = this.validator(this.ajvResponse, `res:${schemaPointer}`, { $ref: `spec${schemaPointer}` });
    return v(payload) ? [] : ajvProblems('webhook', v.errors);
  }

  /** True when `value` validates against components.schemas[name] (response rules). */
  matchesSchema(name: string, value: unknown): boolean {
    if (!this.doc.components?.schemas?.[name]) return false;
    const ptr = `#/components/schemas/${escapePointer(name)}`;
    return this.validator(this.ajvResponse, `res:${ptr}`, { $ref: `spec${ptr}` })(value);
  }

  webhookNames(): string[] {
    return Object.keys(this.doc.webhooks ?? {});
  }

  private validator(ajv: AjvInstance, key: string, schema: Json): ValidateFunction {
    let v = this.validators.get(key);
    if (!v) {
      v = ajv.compile(schema);
      this.validators.set(key, v);
    }
    return v;
  }

  /** Follow local $refs on a non-schema object, tracking the pointer of the result. */
  private resolve(obj: Json, pointer: string): { obj: Json; pointer: string } {
    let current = obj;
    let ptr = pointer;
    for (let i = 0; i < 20 && current && typeof current.$ref === 'string' && current.$ref.startsWith('#'); i++) {
      ptr = current.$ref;
      current = getPointer(this.doc, ptr);
    }
    return { obj: current, pointer: ptr };
  }

  private index() {
    const security = this.doc.security;
    for (const [path, rawItem] of Object.entries<Json>(this.doc.paths ?? {})) {
      const item = this.resolve(rawItem, `#/paths/${escapePointer(path)}`);
      for (const method of METHODS) {
        const op = item.obj?.[method];
        if (!op) continue;
        const opPtr = `${item.pointer}/${method}`;
        const operationId: string = op.operationId ?? `${method.toUpperCase()} ${path}`;
        const params = new Map<string, ParamInfo>();
        const addParams = (list: Json[] | undefined, base: string) =>
          (list ?? []).forEach((raw, i) => {
            const p = this.resolve(raw, `${base}/${i}`);
            if (!p.obj?.name) return;
            const schema = this.resolve(p.obj.schema, `${p.pointer}/schema`);
            params.set(`${p.obj.in}:${p.obj.name}`, {
              name: p.obj.name,
              in: p.obj.in,
              required: p.obj.in === 'path' || !!p.obj.required,
              schemaPointer: p.obj.schema ? `${p.pointer}/schema` : undefined,
              isArray: schema.obj?.type === 'array' || (Array.isArray(schema.obj?.type) && schema.obj.type.includes('array')),
              explode: p.obj.explode ?? (p.obj.style ?? 'form') === 'form',
            });
          });
        addParams(item.obj.parameters, `${item.pointer}/parameters`);
        addParams(op.parameters, `${opPtr}/parameters`);
        // Accept, Content-Type and Authorization header parameters are ignored by OpenAPI.
        for (const [k, p] of params) if (p.in === 'header' && ['accept', 'content-type', 'authorization'].includes(p.name.toLowerCase())) params.delete(k);
        let requestBody: OperationInfo['requestBody'];
        if (op.requestBody) {
          const rb = this.resolve(op.requestBody, `${opPtr}/requestBody`);
          const media: Record<string, string | undefined> = {};
          for (const [m, def] of Object.entries<Json>(rb.obj?.content ?? {})) {
            media[m] = def?.schema ? `${rb.pointer}/content/${escapePointer(m)}/schema` : undefined;
          }
          requestBody = { required: !!rb.obj?.required, media };
        }
        const responses: Record<string, string> = {};
        for (const [code, r] of Object.entries<Json>(op.responses ?? {})) {
          responses[code] = this.resolve(r, `${opPtr}/responses/${escapePointer(code)}`).pointer;
        }
        const sec: Json[] | undefined = op.security ?? security;
        const secured = !!sec && sec.length > 0 && !sec.some((r: Json) => Object.keys(r).length === 0);
        const names: string[] = [];
        const segments = path.split('/').filter(Boolean);
        const pattern = segments
          .map((seg) =>
            seg.replace(/\{([^}]+)\}|[^{]+/g, (part, name) => {
              if (name) {
                names.push(name);
                return '([^/]+)';
              }
              return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }),
          )
          .join('/');
        const info: OperationInfo = {
          operationId,
          pointer: opPtr,
          method: method.toUpperCase(),
          path,
          parameters: [...params.values()],
          requestBody,
          responses,
          secured,
          regex: new RegExp(`^/${pattern}$`),
          pathParamNames: names,
          literalSegments: segments.filter((s) => !s.includes('{')).length,
        };
        if (this.byId.has(operationId)) throw new Error(`Duplicate operationId "${operationId}" in the spec`);
        this.byId.set(operationId, info);
        this.operations.push(info);
      }
    }
    // Most specific first, so /payments/summary wins over /payments/{id}.
    this.operations.sort((a, b) => b.literalSegments - a.literalSegments || a.pathParamNames.length - b.pathParamNames.length);
  }
}

export function getPointer(doc: Json, pointer: string): Json {
  const parts = pointer.replace(/^#/, '').split('/').slice(1);
  let cur = doc;
  for (const raw of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[raw.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

export const escapePointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function pickMedia(keys: string[], contentType: string | undefined): string | undefined {
  const base = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const lower = keys.map((k) => k.toLowerCase());
  const exact = lower.indexOf(base);
  if (exact >= 0) return keys[exact];
  const wildcard = lower.findIndex((k) => k === `${base.split('/')[0]}/*`);
  if (wildcard >= 0) return keys[wildcard];
  const any = lower.indexOf('*/*');
  if (any >= 0) return keys[any];
  // A JSON request against an application/json-only contract that used a vendor +json type.
  if (isJsonMedia(base)) return keys.find(isJsonMedia);
  return undefined;
}

function ajvProblems(where: string, errors: ErrorObject[] | null | undefined, holder = false): ContractProblem[] {
  return (errors ?? []).map((e) => ({
    // Parameters and headers are validated inside a { v: value } holder so coercion can write back.
    where: `${where}${holder ? e.instancePath.replace(/^\/v/, '') : e.instancePath}`,
    message: e.message ?? 'is invalid',
    detail: e.params,
  }));
}

/** Rewrite OpenAPI 3.0 schema idioms into what draft-07 Ajv understands. */
function normalise30(node: Json) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(normalise30);
  for (const [bound, limit] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (node[bound] === true && typeof node[limit] === 'number') {
      node[bound] = node[limit];
      delete node[limit];
    } else if (node[bound] === false) delete node[bound];
  }
  // 3.0 authors mean "this enum, or null"; Ajv requires null to be listed.
  if (node.nullable === true && Array.isArray(node.enum) && !node.enum.includes(null)) node.enum = [...node.enum, null];
  for (const value of Object.values(node)) normalise30(value);
  // `nullable: true` beside allOf/oneOf/anyOf/$ref (the usual 3.0 way to make a referenced
  // schema nullable) only relaxes the outer `type` for Ajv; the inner schema still rejects
  // null. Make the intent explicit: this schema, or null.
  if (node.nullable === true && (node.allOf || node.oneOf || node.anyOf || node.$ref)) {
    const inner: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (key === 'nullable' || key === 'description' || key === 'example') continue;
      inner[key] = node[key];
      delete node[key];
    }
    delete node.nullable;
    node.anyOf = [inner, { type: 'null' }];
  }
}

/** Copy of the document with properties carrying `flag` removed from `required` lists. */
function withoutRequiredFlag(doc: Json, flag: 'readOnly' | 'writeOnly'): Json {
  const copy = structuredClone(doc);
  const flagged = (prop: Json, depth = 0): boolean => {
    if (!prop || typeof prop !== 'object' || depth > 5) return false;
    if (prop[flag] === true) return true;
    if (typeof prop.$ref === 'string' && prop.$ref.startsWith('#')) return flagged(getPointer(copy, prop.$ref), depth + 1);
    return Array.isArray(prop.allOf) && prop.allOf.some((p: Json) => flagged(p, depth + 1));
  };
  const walk = (node: Json) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.properties && Array.isArray(node.required)) {
      node.required = node.required.filter((name: string) => !flagged(node.properties[name]));
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(copy);
  return copy;
}
