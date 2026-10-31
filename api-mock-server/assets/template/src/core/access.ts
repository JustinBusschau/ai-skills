// Who may use the /__mock control plane, decided per request.
//
// 1. Tokens, always. Whether a request truly comes from this machine cannot be told
//    reliably: behind a TCP forwarder (socat, ngrok tcp, kubectl port-forward) a remote
//    caller arrives on a loopback socket and can claim "Host: localhost". So no request
//    is trusted for looking local. Session operations need the control (or admin)
//    token; global operations and unredacted state need the admin token. When none are
//    configured, ensureTokens() in config.ts generates them at startup.
//    MOCK_ALLOW_OPEN_CONTROL=true is the explicit, documented opt-out: it opens every
//    tier, local or shared.
//
// 2. Origins. Browsers send Origin on every cross-origin request and on every POST. A
//    /__mock request whose Origin is neither this server nor on the control-origin
//    allow-list is refused outright, so another website cannot drive the control plane
//    through a tester's browser. Non-browser clients send no Origin and are unaffected.
//    Tokens arrive in X-Mock-Control-Token / X-Mock-Admin-Token, or as the password of
//    HTTP Basic credentials (what a browser prompts for); Basic credentials are ambient
//    (the browser attaches them by itself), so they count only on same-origin requests.
//
// 3. Control paths are recognised after URL decoding and by the route Fastify matched,
//    so /%5F_mock/... cannot slip past as an API path.
import type { FastifyRequest } from 'fastify';
import { ADMIN_TOKEN_HEADER, config, CONTROL_TOKEN_HEADER } from './config.ts';
import { headerValue, tokenMatches } from './util.ts';

const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

export const hostnameOf = (host: string | undefined) => (host ?? '').replace(/:\d+$/, '');

function decodedPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** True for any request that reaches, or claims to reach, the control plane. */
export function isControlRequest(req: FastifyRequest): boolean {
  const route = req.routeOptions?.url ?? '';
  if (route === '/__mock' || route.startsWith('/__mock/')) return true;
  const path = decodedPath(req.url).replace(/\/{2,}/g, '/');
  return path === '/__mock' || path.startsWith('/__mock/');
}

/** Origins this server is reached at: the request's own, and MOCK_PUBLIC_URL behind a proxy. */
export function ownOrigins(req: FastifyRequest): string[] {
  const proto = headerValue(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ?? req.protocol;
  const origins = [`${proto}://${headerValue(req.headers.host) ?? ''}`];
  if (config.publicUrl) {
    try {
      origins.push(new URL(config.publicUrl).origin);
    } catch {
      // validateConfig() rejects malformed values at startup.
    }
  }
  return origins;
}

/** Origins other than this server that may call /__mock from a browser. */
export function controlOriginAllowed(origin: string): boolean {
  if (config.controlOrigins.includes(origin)) return true;
  // Default for a loopback-bound mock: web apps under development on this machine,
  // e.g. an end-to-end suite at http://localhost:3000 resetting its session. They
  // still need a token header to do anything beyond reading an open catalogue.
  if (!config.shared && config.controlOrigins.length === 0) {
    try {
      const u = new URL(origin);
      return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOST.test(u.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

export type OriginVerdict = 'none' | 'same' | 'allowed' | 'refused';

export function originVerdict(req: FastifyRequest): OriginVerdict {
  const origin = headerValue(req.headers.origin);
  if (!origin) return 'none';
  if (ownOrigins(req).includes(origin)) return 'same';
  return controlOriginAllowed(origin) ? 'allowed' : 'refused';
}

function basicPassword(req: FastifyRequest): string | undefined {
  // Ambient credentials only count when the request did not come from another origin.
  if (!['none', 'same'].includes(originVerdict(req))) return undefined;
  const auth = headerValue(req.headers.authorization);
  if (!auth?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i >= 0 ? decoded.slice(i + 1) : undefined;
}

export const hasAdminToken = (req: FastifyRequest) =>
  tokenMatches(headerValue(req.headers[ADMIN_TOKEN_HEADER]), config.adminToken) || tokenMatches(basicPassword(req), config.adminToken);

export const hasControlToken = (req: FastifyRequest) =>
  hasAdminToken(req) ||
  tokenMatches(headerValue(req.headers[CONTROL_TOKEN_HEADER]), config.controlToken) ||
  tokenMatches(basicPassword(req), config.controlToken);

/** Session operations: reset, state, arm, clock, requests, webhooks. */
export const mayControl = (req: FastifyRequest) => config.allowOpenControl || hasControlToken(req);

/** Global operations (reset-all, sessions) and unredacted state. */
export const mayAdminister = (req: FastifyRequest) => config.allowOpenControl || hasAdminToken(req);

/** Catalogue: /__mock/, personas, scenarios, docs, openapi.json. */
export const mayReadCatalogue = (req: FastifyRequest) => config.catalogueAccess === 'open' || config.allowOpenControl || hasControlToken(req);

export function refusalReason(_req: FastifyRequest, needs: string): string {
  return (
    `This needs ${needs}: send it in that header, or as the password when the browser asks (any user name). ` +
    `On a local mock the tokens are printed at startup and saved in .mock-tokens.`
  );
}

export const TOKEN_HEADERS = { control: CONTROL_TOKEN_HEADER, admin: ADMIN_TOKEN_HEADER };
