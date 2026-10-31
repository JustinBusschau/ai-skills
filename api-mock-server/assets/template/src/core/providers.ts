// Simulated third-party pages (identity verification, card checkout, document signing)
// that a client opens in a WebView. The client never sends mock headers from inside a
// WebView, so each page URL carries its session id and an HMAC signature (keyed by the
// admin token) instead of a control token: only URLs the mock itself handed out work.
// Choosing an outcome changes state through the domain and redirects to the client's
// returnUrl, so the whole journey, including the deep link back, can be tested.
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from './config.ts';
import { buildContext, settle, virtualNow } from './context.ts';
import type { Engine } from './engine.ts';
import { SessionStore } from './sessions.ts';
import { tokenMatches } from './util.ts';

const sign = (session: string, provider: string, ref: string) =>
  createHmac('sha256', config.adminToken || 'unset').update(`${session}\n${provider}\n${ref}`).digest('base64url').slice(0, 24);

export function fileUrl(origin: string, session: string, ref: string, expiresAtMs: number): string {
  const exp = String(Math.floor(expiresAtMs));
  const q = new URLSearchParams({ session, exp, sig: sign(session, 'file', `${ref}\n${exp}`) });
  return `${origin}/__mock/files/${encodeURIComponent(ref)}?${q}`;
}

export function providerUrl(origin: string, session: string, provider: string, ref: string): string {
  const q = new URLSearchParams({ session, sig: sign(session, provider, ref) });
  return `${origin}/__mock/providers/${encodeURIComponent(provider)}/${encodeURIComponent(ref)}?${q}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f3f4f6;color:#111827}
main{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.badge{display:inline-block;font-size:12px;background:#fde68a;border-radius:4px;padding:2px 8px;margin-bottom:12px}
button{display:block;width:100%;font-size:16px;padding:12px;margin:8px 0;border-radius:8px;border:1px solid #9ca3af;background:#fff;cursor:pointer}
p{line-height:1.5}
</style></head><body><main><span class="badge">Mock provider page</span>${body}</main></body></html>`;
}

export function registerProviders(app: FastifyInstance, engine: Engine) {
  const { domain, store, contract } = engine;
  type Req = { Params: { provider: string; ref: string }; Querystring: { session?: string; sig?: string }; Body: { outcome?: string } };

  const open = (req: { params: Req['Params']; query: Req['Querystring'] }) => {
    const provider = domain.providers?.[req.params.provider];
    const session = req.query.session ?? '';
    if (!provider || !SessionStore.isValidId(session) || !tokenMatches(req.query.sig, sign(session, req.params.provider, req.params.ref))) return undefined;
    const s = store.get(session).session;
    settle(domain, contract, s);
    return { provider, s };
  };
  const headers = { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", 'cache-control': 'no-store' };

  app.get<Req>('/__mock/providers/:provider/:ref', async (req, reply) => {
    const o = open(req);
    if (!o) return reply.code(404).headers(headers).type('text/html; charset=utf-8').send(page('Not found', '<h1>Link not recognised</h1><p>This provider link is not valid for any session on this mock.</p>'));
    const mc = buildContext(domain, contract, o.s, undefined);
    const view = o.provider.describe(mc, req.params.ref);
    if (!view) return reply.code(404).headers(headers).type('text/html; charset=utf-8').send(page(o.provider.title, `<h1>${esc(o.provider.title)}</h1><p>Nothing is waiting here any more.</p>`));
    const action = `/__mock/providers/${encodeURIComponent(req.params.provider)}/${encodeURIComponent(req.params.ref)}?${new URLSearchParams(req.query as Record<string, string>)}`;
    const buttons = view.outcomes.map((x) => `<button name="outcome" value="${esc(x.id)}">${esc(x.label)}</button>`).join('');
    return reply.headers(headers).type('text/html; charset=utf-8').send(
      page(o.provider.title, `<h1>${esc(o.provider.title)}</h1><p>${esc(view.summary)}</p><form method="post" action="${esc(action)}">${buttons}</form>`),
    );
  });

  // Short-lived signed download links (mc.fileUrl): valid only for their session and
  // only until their expiry on that session's clock.
  app.get<{ Params: { ref: string }; Querystring: { session?: string; exp?: string; sig?: string } }>('/__mock/files/:ref', async (req, reply) => {
    const { session = '', exp = '', sig } = req.query;
    if (!domain.files || !SessionStore.isValidId(session) || !tokenMatches(sig, sign(session, 'file', `${req.params.ref}\n${exp}`))) {
      return reply.code(404).send({ error: 'File link not recognised.' });
    }
    const s = store.get(session).session;
    if (virtualNow(s) > Number(exp)) return reply.code(410).send({ error: 'This file link has expired; request a new one.' });
    const file = domain.files(buildContext(domain, contract, s, undefined), req.params.ref);
    if (!file) return reply.code(404).send({ error: 'File not found.' });
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', `inline; filename="${file.filename.replace(/["\\]/g, '')}"`)
      .type(file.contentType)
      .send(file.content);
  });

  app.post<Req>('/__mock/providers/:provider/:ref', async (req, reply) => {
    const o = open(req);
    if (!o) return reply.code(404).send({ error: 'Provider link not recognised.' });
    const mc = buildContext(domain, contract, o.s, undefined);
    const outcome = String((req.body as Record<string, unknown> | undefined)?.outcome ?? '');
    const view = o.provider.describe(mc, req.params.ref);
    if (!view || !view.outcomes.some((x) => x.id === outcome)) return reply.code(400).send({ error: 'Unknown outcome for this page.' });
    const result = o.provider.complete(mc, req.params.ref, outcome);
    if (result.redirectTo) return reply.redirect(result.redirectTo, 303);
    return reply.headers(headers).type('text/html; charset=utf-8').send(page(o.provider.title, `<h1>${esc(o.provider.title)}</h1><p>${esc(result.message ?? 'Done. You can close this page.')}</p>`));
  });
}
