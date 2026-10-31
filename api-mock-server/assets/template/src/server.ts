import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { isControlRequest, originVerdict } from './core/access.ts';
import { assertSafeToServe, registerAdmin } from './core/admin.ts';
import { config, ensureTokens } from './core/config.ts';
import { MalformedBody } from './core/contract.ts';
import { parseForm, parseMultipart } from './core/util.ts';
import { createEngine } from './core/engine.ts';
import { registerProviders } from './core/providers.ts';
import { domain } from './domain/index.ts';

// Every method an API may use; the plugin's default (GET, HEAD, POST) would block
// browser apps from calling PUT, PATCH, and DELETE endpoints.
const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export async function buildServer() {
  // Tests keep generated tokens in memory; a real server saves them to .mock-tokens.
  const tokens = ensureTokens({ persist: process.env.NODE_ENV !== 'test' || !!process.env.MOCK_TOKENS_FILE });
  assertSafeToServe();
  const engine = await createEngine(domain);
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && { level: process.env.LOG_LEVEL ?? 'info' } });
  // CORS differs by route. API routes: any configured origin, with credentials, as a
  // browser app needs. /__mock routes: only this server and trusted control origins,
  // and never with credentials, so a cached browser login cannot be used cross-site.
  const exposedHeaders = [
    'x-mock-session',
    'x-mock-session-created',
    'x-mock-operation',
    'x-mock-scenario-applied',
    'x-mock-fault',
    'x-mock-source',
    'x-mock-undocumented-status',
    'x-mock-contract-violation',
    'x-mock-idempotent-replay',
    'retry-after',
    // A browser app can read only the headers listed here: add the spec's own, and any
    // X-Mock-* headers the domain sets (such as a link to a simulated provider page).
    ...engine.contract.documentedResponseHeaders(),
    ...(domain.exposeHeaders ?? []).map((h) => h.toLowerCase()),
  ].filter((h, i, all) => all.indexOf(h) === i);
  await app.register(cors, {
    delegator: (req: FastifyRequest, cb: (err: Error | null, opts: Record<string, unknown>) => void) => {
      if (isControlRequest(req)) {
        const verdict = originVerdict(req);
        return cb(null, { origin: verdict === 'allowed', credentials: false, exposedHeaders, methods: CORS_METHODS });
      }
      return cb(null, { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true, exposedHeaders, methods: CORS_METHODS });
    },
  });
  // Refuse /__mock requests a browser made on behalf of another website. Top-level
  // navigation (opening the docs from a link) sends no Origin and is unaffected.
  app.addHook('onRequest', async (req, reply) => {
    if (isControlRequest(req) && originVerdict(req) === 'refused') {
      return reply.code(403).send({
        error: `Requests to /__mock from ${req.headers.origin} are refused. Add it to MOCK_CONTROL_ORIGINS if it is a trusted app.`,
      });
    }
  });
  // Accept any body; the contract layer validates it.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(/^application\/(?:[\w.+-]+\+)?json/i, { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      // Keep it so contract validation can report it as the contract's validation error.
      done(null, new MalformedBody(body as string, err instanceof Error ? err.message : String(err)));
    }
  });
  // Repeated fields (scope=a&scope=b) become arrays rather than keeping only the last value.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, parseForm(body as string)));
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (req, body, done) => {
    parseMultipart(body as Buffer, String(req.headers['content-type'])).then(
      (parsed) => done(null, parsed),
      (err: Error) => done(null, new MalformedBody('', `malformed multipart body: ${err.message}`)),
    );
  });
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  registerAdmin(app, engine);
  registerProviders(app, engine);
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-mock-server', domain.name);
  });
  // OPTIONS is left to the CORS plugin, which answers preflight requests.
  app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/*', handler: (req, reply) => engine.handle(req, reply) });
  return { app, engine, tokens };
}

function isMain() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] ?? ''));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { app, tokens } = await buildServer();
  await app.listen({ host: config.host, port: config.port });
  if (tokens.generated) {
    console.log(
      `\nControl-plane tokens were generated and saved to ${config.tokensFile}:\n` +
        `  control (testers):  ${config.controlToken}\n  admin:              ${config.adminToken}\n` +
        `Send them as X-Mock-Control-Token / X-Mock-Admin-Token, or enter one as the password when a browser asks.\n`,
    );
  }
  if (config.allowOpenControl) {
    app.log.warn('MOCK_ALLOW_OPEN_CONTROL=true: no token is needed for any /__mock operation; anyone who can reach this port can read and reset every session.');
  }
}
