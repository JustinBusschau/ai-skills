# __API_TITLE__ mock server

A stateful mock of __API_TITLE__, built from `spec/openapi.yaml`, for app and web teams to develop and test against until the real live or sandbox environment is available.

__SOURCE_NOTE__

## Running it

It needs Node.js 22.13 or later on the 22 line, 24, or 26 or later (vitest does not support the odd-numbered releases).

On first start the mock generates two control-plane tokens, prints them, and saves them in `.mock-tokens` (git-ignored, readable only by you); later starts reuse them. Give the control token to anyone who needs to reset sessions, move the clock, or force outcomes. To choose your own, set `MOCK_CONTROL_TOKEN` and `MOCK_ADMIN_TOKEN`.

```bash
npm install
npm run dev          # http://127.0.0.1:4010__BASE_PATH__, restarts on change
```

If the spec is split across several files, they live in `spec/source/`; run `npm run bundle:spec` after changing any of them to rebuild `spec/openapi.yaml`.

Settings are read from environment variables, and from `.env` if present (variables set in the shell take precedence). `.env.example` lists every setting with its default.

To run one instance for a team, use Docker. Binding beyond this machine makes it a shared instance, which refuses to start without both tokens:

```bash
docker build -t __PROJECT_NAME__ .
docker run -p 4010:4010 \
  -e MOCK_ADMIN_TOKEN=<for whoever runs the instance> \
  -e MOCK_CONTROL_TOKEN=<for testers> \
  __PROJECT_NAME__
```

Point the client at `http://<host>:4010__BASE_PATH__` in place of the real base URL. CORS is open by default so browser apps work without a proxy.

## Documentation

Open `http://<host>:4010/__mock/docs` in a browser. It shows the full API in Swagger UI, with each operation's test cases written into it: every scenario with its status, error code, and how to trigger it, the generic 401 and validation responses, and a ready-to-run `curl` command per scenario. The page header lists the personas and their credentials, and explains sessions, the clock, and how to force an outcome.

A toolbar at the top sets the session, the persona whose credentials to send, and a scenario to force; these apply to every "Try it out" request, which goes to this mock. The annotated spec behind the page is at `/__mock/openapi.json`, for importing into Postman, Insomnia, or similar tools.

Swagger UI loads from `cdn.jsdelivr.net`, pinned to one version and checked against integrity hashes, so the browser needs internet access. Without it the page says so and points to `/__mock/scenarios` and `SCENARIOS.md`, which hold the same test cases.

## Personas and scenarios

`SCENARIOS.md` lists every seeded persona (with its credentials) and every outcome the mock can produce, with the exact input that produces it. The same catalogue is served live at `GET /__mock/personas` and `GET /__mock/scenarios`.

Most outcomes need nothing mock-specific in the client: sign in as the right persona, or send the documented test value (a particular card token, surname, or amount), and the mock behaves as the real API would in that situation. A small number of outcomes, such as provider outages, can only be reached on demand; see "Forcing an outcome" below.

## Keeping test runs independent

State is held in memory per session. Send `X-Mock-Session: <any-id>` (letters, digits, `.`, `_`, `-`; up to 64 characters) to work in your own copy of the seeded data; without it, requests use the shared `default` session. Use one id per developer, per device, or per automated test run so that nobody's changes affect anyone else.

- `POST /__mock/reset` restores your session to the seed data.
- `POST /__mock/personas/<id>/reset` restores one persona and leaves the rest of the session alone.
- A session idle for `MOCK_SESSION_TTL_MINUTES` (default 24 hours) is discarded. When more than `MOCK_MAX_SESSIONS` (default 500) exist, the least recently used is discarded. Either way it is re-seeded on next use, and that response carries `X-Mock-Session-Created: true`.
- Restarting the server discards every session.

Journeys such as onboarding can be repeated without creating new accounts: see the personas marked "Resets on sign-in" and any repeatable sign-up addresses described in `SCENARIOS.md`.

## Time, asynchronous outcomes, and webhooks

Outcomes the real API decides later (reviews, settlements, expiries) happen on a per-session clock. By default the clock is live: it follows real time, so waiting works, and you can jump ahead instead:

```bash
curl -X POST localhost:4010/__mock/clock/advance -H 'X-Mock-Session: me' \
  -H "X-Mock-Control-Token: $MOCK_CONTROL_TOKEN" \
  -H 'content-type: application/json' -d '{"seconds": 60}'
```

For reproducible automated tests, freeze the clock (`POST /__mock/clock/freeze`, optionally with `{"at": "2026-03-02T09:00:00Z"}`), or start every session frozen with `MOCK_CLOCK=frozen` and `MOCK_CLOCK_START`. A frozen clock moves only when you advance it, so every timestamp in every response is the same on every run. Seed data described as relative to today ("issued 3 days ago") is fixed when the session is created or reset, so advancing the clock moves time past it. `POST /__mock/clock/resume` sets it running again.

If the API sends webhooks, register where your session's webhooks should go with `POST /__mock/webhooks/target {"url": "http://localhost:3000/hooks"}`. The host must be on `MOCK_WEBHOOK_ALLOWED_HOSTS`, which defaults to localhost on a local instance and to nothing on a shared one. A target on this machine's own loopback, like the example, needs the admin token (see "Control plane access"); with only the control token, use a host listed in `MOCK_WEBHOOK_ALLOWED_HOSTS` that is not loopback. Redirects are not followed. Every event, delivered or not, is recorded at `GET /__mock/webhooks/log`, and `POST /__mock/webhooks/trigger` fires one on demand.

## Forcing an outcome

For automated tests and error-handling work. Only the built-in ids below and scenarios whose trigger is "header" in `SCENARIOS.md` can be forced; the others are reached by persona or input, as described there, and asking to force one returns a 400 that says which can be, rather than pretending.

- `X-Mock-Scenario: <id>` on a request forces that outcome for that request. Ids for other operations are ignored, so one header value can cover a whole journey.
- `POST /__mock/arm {"operationId": "<id>", "scenario": "<id>", "times": 2}` forces the next calls in your session, for clients (such as third-party SDKs or release builds) that cannot add headers. Use `"operationId": "*"` with a built-in id to affect every operation. An armed outcome is used up only when it takes effect, so a call rejected for missing credentials or an invalid body does not consume it.

Built-in ids work on every operation: `fault.server_error`, `fault.unavailable`, `fault.rate_limited`, `fault.timeout`, `fault.connection_reset`, `fault.malformed_json`, `delay.<ms>` (up to `MOCK_MAX_DELAY_MS`, combinable with any other id), and `example.<status>` (the spec's own example for a documented status).

## Control plane access

The control plane always needs a token, including on your own machine. Whether a request really comes from this machine cannot be told reliably (behind a TCP forwarder or tunnel, a remote caller looks local), so the mock does not try; this keeps a local mock safe when you expose it through ngrok, port forwarding, or a proxy.

- the catalogue (`/__mock/`, `/__mock/personas`, `/__mock/scenarios`, `/__mock/docs`, `/__mock/openapi.json`) is open when `MOCK_CATALOGUE_ACCESS=open` (the default), and needs the control token when it is `token`. Choose `token` if persona credentials should not be readable by everyone who can reach the server;
- session operations (reset, state, arm, clock, requests, webhooks) need the control token;
- `/__mock/reset-all`, `/__mock/sessions`, and unredacted state need the admin token. Without it, `/__mock/state` replaces password- and secret-like fields with `[redacted]`.

Send a token as `X-Mock-Control-Token: <MOCK_CONTROL_TOKEN>` or `X-Mock-Admin-Token: <MOCK_ADMIN_TOKEN>`. A browser is prompted for it instead: enter any user name and the token as the password. Every prompt comes from a URL under `/__mock/`, so browsers keep those credentials for `/__mock/` and do not attach them to API requests, and they are only honoured on requests from the mock's own pages.

Browser requests to `/__mock` from other websites are refused, so a page a tester happens to visit cannot reset sessions or read state through their browser. Web apps under development on the same machine (any `localhost` origin) may call it, using the token headers; list other trusted app origins in `MOCK_CONTROL_ORIGINS`. Scripts and test runners outside a browser are unaffected. Behind a proxy that rewrites the `Host` header or omits `X-Forwarded-Proto`, set `MOCK_PUBLIC_URL` so the docs page's own requests are recognised as same-origin.

A webhook target on this machine's own loopback (`localhost`, `127.0.0.1`) can reach any local service, so registering one needs the admin token, whoever asks. Holders of the control token can register targets on any other host listed in `MOCK_WEBHOOK_ALLOWED_HOSTS`.

Session ids are not secrets: anyone with the control token can act on any session. Do not type real passwords or personal details into a mock.

## What the contract check does and does not cover

Every request is validated against the spec before a handler runs. Every response body, status, and documented response header the mock returns is validated against the spec; a mismatch becomes a 500 with `X-Mock-Contract-Violation: true` and an explanation, so drift between the mock and the contract is visible. Webhook payloads are validated against the spec's webhook schemas and are not delivered if they fail.

The exceptions are deliberate and marked:

- built-in faults (`X-Mock-Fault`) return what they describe, including statuses an operation may not document;
- the mock sends 401 for missing credentials and a validation error for invalid requests even where the operation does not document those statuses, because the real API would too; these carry `X-Mock-Undocumented-Status: true`;
- an operation with no implemented handler answers from the spec's examples and carries `X-Mock-Source: spec-example`.

Passing these checks shows that responses match the spec. It does not show that the spec matches the real API; `ASSUMPTIONS.md` records where the mock had to interpret the source.

## Seeing what happened

- `GET /__mock/state` shows your session's data, its clock, and any pending scheduled changes.
- `GET /__mock/requests` shows your session's recent requests, with the scenario applied to each.
- Response headers `X-Mock-Session`, `X-Mock-Session-Created`, `X-Mock-Scenario-Applied`, `X-Mock-Fault`, `X-Mock-Source`, and `X-Mock-Undocumented-Status` explain each response.

## Limits

- State is in memory in a single process. Do not run several replicas behind a load balancer.
- Request bodies are parsed and validated as JSON (including `+json` types) form-encoded data, and multipart form data (form fields and multipart text parts are coerced to their schema types, JSON parts are parsed, and uploaded files reach handlers with their name, type, and size, up to 60 MB per request); other types reach handlers as text without schema validation. Query parameters use Fastify's parser, so `deepObject` style is not supported.
- The mock serves every operation under the one base path from the spec's first server. Operations the real API serves from a different host or path keep their paths here, and the docs page notes the difference.
- This mock contains no real data. Do not point it at, or load it with, production data or credentials.

## Maintaining it

```bash
npm run verify
```

checks the spec is a valid OpenAPI 3.0 or 3.1 document, regenerates types, type-checks, checks that every documented response, state value, and webhook is reachable, runs every scenario twice (with a frozen clock, to prove responses are reproducible) along with the generated authentication and validation checks, and regenerates `SCENARIOS.md`. Run it after any change to the spec or the mock.
