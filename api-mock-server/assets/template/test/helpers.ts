import type { FastifyInstance } from 'fastify';
import { config } from '../src/core/config.ts';
import { domain } from '../src/domain/index.ts';
import type { ScenarioRequest } from '../src/core/types.ts';

const BOUNDARY = 'mock-boundary-7d1f0c';

/** Content-Type header for a request's body. */
export const contentTypeOf = (r: ScenarioRequest) =>
  r.contentType === 'multipart/form-data' ? `multipart/form-data; boundary=${BOUNDARY}` : (r.contentType ?? 'application/json');

/** Encode a body the way the request's content type says (arrays repeat a form field). */
export function encodeBody(r: ScenarioRequest): string | undefined {
  if (r.body === undefined) return undefined;
  if (r.contentType === 'multipart/form-data') {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(r.body as Record<string, unknown>)) {
      const file = (v as { $file?: { filename: string; contentType: string; content?: string } })?.$file;
      if (file) {
        parts.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n${file.content ?? '%PDF-1.4 mock'}\r\n`);
      } else if (v && typeof v === 'object') {
        parts.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(v)}\r\n`);
      } else {
        parts.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${String(v)}\r\n`);
      }
    }
    return `${parts.join('')}--${BOUNDARY}--\r\n`;
  }
  if (r.contentType !== 'application/x-www-form-urlencoded') return JSON.stringify(r.body);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(r.body as Record<string, unknown>)) {
    for (const item of Array.isArray(v) ? v : [v]) form.append(k, String(item));
  }
  return form.toString();
}

export function call(app: FastifyInstance, session: string, r: ScenarioRequest, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    'x-mock-session': session,
    ...(r.persona ? domain.authHeadersFor(r.persona) : {}),
    ...(r.body !== undefined ? { 'content-type': contentTypeOf(r) } : {}),
    // Setup steps may call the control plane (e.g. reset a persona); they need a token like anyone.
    ...(r.path.startsWith('/__mock') ? { 'x-mock-admin-token': config.adminToken } : {}),
    ...(r.headers ?? {}),
    ...extra,
  };
  const qs = r.query ? `?${new URLSearchParams(r.query)}` : '';
  return app.inject({ method: r.method as 'GET', url: r.path + qs, headers, payload: encodeBody(r) });
}

/** A control-plane call, with the admin token (generated in memory for the tests by buildServer). */
export function control(app: FastifyInstance, session: string, method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method,
    url,
    headers: {
      'x-mock-session': session,
      'x-mock-admin-token': config.adminToken,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const sessionFor = (prefix: string, id: string) => `${prefix}-${id}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);

export const tryJson = (body: string) => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};
