# The runtime template

The template in `assets/template` is a working TypeScript mock runtime (Node 22.13 or later on 22.x, 24.x, or 26 and later; Fastify; Ajv). It accepts OpenAPI 3.0 and 3.1 specs. It is API-agnostic: everything specific to one API lives in `src/domain`. Read this before implementing the domain, and again if you need to change the runtime.

## Contents

1. Layout
2. Request pipeline
3. Writing handlers
4. The domain module
5. Verification and what it proves
6. Changing the runtime
7. Other stacks

## 1. Layout

```
spec/openapi.yaml          the contract; the single source of truth
src/server.ts              Fastify setup, CORS, body parsing, routes
src/core/                  API-agnostic runtime; avoid changing it (see section 6)
  config.ts                environment variables (and .env), shared-instance detection
  contract.ts              spec loading, routing, and request/response/webhook validation
  engine.ts                request pipeline, faults, contract checking of responses
  checks.ts                401 and validation checks derived from the contract
  sessions.ts              per-session state with idle TTL and a session cap
  context.ts               MockContext, the per-session clock, scheduled changes
  scenarios.ts             X-Mock-Scenario parsing, armed scenarios, built-ins
  access.ts                who may use /__mock: tokens, origins, control-path detection
  admin.ts                 the /__mock control plane and its access tiers
  states.ts                state values to cover, and checking covers labels against responses
  docs.ts                  /__mock/docs (Swagger UI) and the annotated /__mock/openapi.json
  providers.ts             simulated provider pages (WebView journeys) behind signed URLs
  webhooks.ts              webhook validation and delivery with a host allow-list
  types.ts                 Domain, Persona, Scenario, MockHandler, MockRequest, MockContext
src/domain/                everything specific to this API
  state.ts                 the State type (plain JSON)
  personas.ts              persona list, seedPersona(), createState()
  scenarios.ts             the scenario registry
  handlers/                one file per resource or tag; index.ts maps operationId -> handler
  index.ts                 the Domain object tying it together
src/generated/api-types.ts types generated from the spec by `npm run gen:types`
scripts/bundle-spec.ts        bundles a multi-file spec from spec/source/ into spec/openapi.yaml
scripts/check-spec.ts         fails if the spec is not a valid OpenAPI 3.0 or 3.1 document
scripts/check-docs-cdn.ts     checks the pinned Swagger UI files against their integrity hashes (network)
scripts/scenario-coverage.ts  fails on unreachable documented responses, state values, or webhooks
scripts/scenario-docs.ts      writes SCENARIOS.md from the registry
test/scenarios.test.ts        runs every scenario (twice), every generated check, every webhook trigger
test/docs.test.ts             checks the annotated spec and the docs page
test/shared-mode.test.ts      checks the access rules of a shared instance and catalogue access
```

`assets/example-acme-wallet` holds a complete domain (sign-up, sign-in, onboarding with a delayed KYC decision, payments with magic card tokens, pagination, and a webhook) for a small OpenAPI 3.1 spec. It passes `npm run verify`. Read it as a model for structure and idiom, not as content to copy.

### How the contract layer works

`contract.ts` bundles the spec into one document (inlining external `$ref`s) and checks it with `@readme/openapi-parser`. It validates schemas with Ajv against JSON pointers into that document, so internal and circular `$ref`s resolve without dereferencing. For 3.0 it uses draft-07 Ajv and rewrites 3.0 idioms first (boolean `exclusiveMinimum`/`exclusiveMaximum`, and `nullable` enums that do not list `null`); for 3.1 it uses Ajv's 2020-12 mode. Requests are validated against a copy of the document in which `readOnly` properties are not required, and responses against one in which `writeOnly` properties are not required. Path, query, header, and cookie parameters are coerced to their schema types. Response keys are matched exactly, then by range (`4XX`), then `default`. Server URL variables in the base path are replaced by their defaults.

Form-encoded bodies are validated with the same type coercion as query parameters. Known limits: `deepObject` query parameters and multipart bodies are not parsed (multipart reaches handlers as text, unvalidated); `discriminator` is not used for validation (plain `oneOf`/`anyOf` semantics apply, so overlapping `oneOf` branches fail as JSON Schema says they should); operations without an `operationId` get the id `<METHOD> <path>`.

## 2. Request pipeline

For each request outside `/__mock`, `engine.ts` does the following, in order:

1. Resolves the session from `X-Mock-Session` (default `default`), creating and seeding it if needed (and marking the response `X-Mock-Session-Created: true`), then runs any scheduled changes that have come due.
2. Matches the route (HEAD falls back to the GET operation). Unknown routes get 404 and wrong methods 405, in the domain's error envelope.
3. Collects scenario ids from `X-Mock-Scenario`; unknown ids return 400 with a pointer to the catalogue.
4. Applies `delay.<ms>` (capped by `MOCK_MAX_DELAY_MS`) and any `fault.*`, from the header or an armed scenario.
5. Returns 401 when the operation has a security requirement and `domain.resolvePrincipal` finds no principal.
6. Validates the request against the contract, returning `domain.validationErrorStatus` with the problems listed.
7. Consumes an armed (non-fault) scenario, if any, now that it will take effect.
8. Applies `example.<status>` or a header-triggered scenario's `respond()`, or calls the handler, or answers from the spec's examples when no handler exists (marked `X-Mock-Source: spec-example`). A handler that throws produces a 500 marked `X-Mock-Handler-Error`.
9. Validates the response status, body, and documented headers. In `strict` mode (the default) a violation becomes a 500 with `X-Mock-Contract-Violation: true`. The runtime's own 401 and validation responses on operations that do not document those statuses pass through marked `X-Mock-Undocumented-Status: true`.
10. Logs the request in the session's request log.

## 3. Writing handlers

A handler has the signature `(req: MockRequest, mc: MockContext) => MockResult`. `req` has already passed contract validation: use `req.params`, `req.query` (both coerced to their schema types), `req.body`, `req.headers`, `req.cookies`, and `req.operationId`.

From `mc` use:

- `mc.state`: this session's data. Mutate it directly.
- `mc.principal`: the authenticated subject (always present on secured operations).
- `mc.now()`: the session's virtual time. Never call `Date.now()` or `new Date()` without arguments in domain code: it bypasses clock advance and freezing, and the test suite's determinism check will fail.
- `mc.schedule(delayMs, label, fn)`: a state change at a later virtual time. The function receives a fresh `MockContext`.
- `mc.emitWebhook(event, payload)`: validate and queue a webhook to the session's registered target.
- `mc.error(status, code, message, details?)`: an error result in the contract's envelope.
- `mc.scenarios`: ids requested for this call, for handlers that vary detail within an outcome.
- `mc.requestId`: a UUID unique within the session and identical on every run of the same requests; use it for correlation ids. `domain.errorBody` receives it too. Only API requests advance it (`uuidFrom('request:<n>')` for the session's nth API request); contexts for scheduled work, actions, and provider pages get ids of their own, so a scenario can predict an id issued by an earlier setup step.
- `mc.session.startedAt`: the virtual time (epoch milliseconds) when the session was created or last reset. Anchor seed data described relative to "today" here, not to `mc.now()`, or it moves along with every clock advance and never expires.
- `mc.origin` and `mc.providerUrl(provider, ref)`: the origin the client used, and a signed link to a simulated provider page (see below).
- `mc.fileUrl(ref, expiresAt)`: a signed download link, valid for this session until `expiresAt` on its clock, served from `domain.files` at `/__mock/files/<ref>`. Use it where the contract returns a short-lived signed URL, so the client can really open the file.

`req.files` holds uploaded files from a multipart body (filename, content type, size); the body field itself holds a short text marker so it validates as the contract's `format: binary` string. JSON parts are parsed into objects.

Return `{ status, body, headers? }`. Type bodies with the generated types (`components['schemas']['Payment']` from `src/generated/api-types.ts`) once `npm run gen:types` has run, so a mismatch fails at type-check time as well as at run time.

Keep handlers small and literal: read state, decide the outcome, change state, return. Generate ids from a counter in state (as the example's `nextId` does), never from randomness. Put magic values and delays in exported constants near the handler, and import them into `scenarios.ts` so the catalogue and the behaviour cannot drift apart.

## 4. The domain module

`src/domain/index.ts` exports a `Domain` object (see `src/core/types.ts` for the full interface):

- `name`, `createState`, `personas`, `scenarios`, `handlers`.
- `resolvePrincipal(headers, state, now)`: map the contract's credential (bearer token, API key header, basic auth, cookie) to a subject in state. Return undefined for anything unrecognised, revoked, or expired; `now` is the session's virtual time, so token expiry follows clock advances.
- `authHeadersFor(personaId)`: the headers that authenticate as a persona; the tests use it. `checkPersona` names the persona the generated validation checks authenticate as (default: the first).
- `errorBody(status, code, message, details)` and `errorCodeOf(body)`: write and read exactly the contract's error envelope. If the contract uses RFC 9457 problem details, return `{ type, title, status, detail }` and set `errorContentType: 'application/problem+json'`.
- `validationErrorStatus`: the status the contract uses for invalid requests (400 or 422).
- Optional: `errorContentType`, `resetPersona`, `webhookTriggers`, `webhookContracts`, `webhookOperations`, `signWebhook`, `exposeHeaders` (response headers a handler sets beyond those the spec documents, so browser apps may read them), and `coverageExemptions`.

Webhook payloads are validated against the spec. For a 3.1 spec, name each trigger after its `webhooks` key and nothing else is needed. For a 3.0 spec that documents webhooks as ordinary paths (the convention `api-contract-to-openapi` uses), list those operationIds in `webhookOperations` (so they are not served or counted as client endpoints) and map each event to its operation in `webhookContracts`.

**Idempotency.** When an operation declares an `Idempotency-Key` header parameter, the runtime stores each response by operation and key for the session. A retry with the same key and the same request gets the stored response again (marked `X-Mock-Idempotent-Replay: true`) without running the handler; the same key with a different request gets a 409 with the runtime code `idempotency_key_reused`, which `errorBody` maps onto the contract's code.

**Back-office actions** (`domain.actions`). Many states are reached by events the client never causes: an underwriting decision, a completion, a review. Give each a named action; testers run it with `POST /__mock/actions/<name>` (control token, `X-Mock-Session`), scenarios can use it as a setup step, and the docs page lists them. Throw an `Error` from `run` to refuse (the caller gets 409 with the message). Prefer an action over a forcing header for these, because the state then really changes and every later read reflects it.

**Provider pages** (`domain.providers`). When the contract hands the client a URL to open in a WebView (an identity check, a card checkout, a signing session), return `mc.providerUrl(name, ref)` there. The page shows the outcomes `describe` offers; choosing one calls `complete`, which changes state and returns the client's `returnUrl` to redirect to. The URL carries the session id and an HMAC signature keyed by the admin token, so the WebView needs no token and only links the mock issued work.

`coverageExemptions` maps `"<operationId>.<response key>"`, `"Schema.field=value"`, or `"webhook.<event>"` to a reason, for an outcome the mock deliberately does not simulate. Use it rarely and only with a reason the user would accept, because each exemption is an outcome the client team cannot test; list every exemption in your final report.

## 5. Verification and what it proves

`npm run verify` runs, in order: `check:spec`, `gen:types`, `typecheck`, `coverage:scenarios`, `test`, and `docs:scenarios`. Between them they establish:

- **The contract is valid** OpenAPI 3.0 or 3.1.
- **Every operation is implemented**: it has a handler, and at least one scenario that does not force its outcome by header reaches that handler.
- **Every documented response is reachable**: each response key of each operation is produced by a scenario, a generated check, or (for exact 429, 500, and 503 keys only) a built-in fault whose body and headers satisfy that response.
- **Every state value is reachable**: each enum value of a state-like field (a property whose name ends in status, state, stage, step, phase, outcome, result, decision, or verification, anywhere inside a schema in `components.schemas`, including `allOf`/`oneOf`/`anyOf` parts, nested objects, and array items, with its values given as an inline or referenced enum, a `const`, the union of `oneOf`/`anyOf`/`allOf` branches, or the items of an array) appears in some scenario's `covers` as `Schema.path.to.field=value`. The test confirms that scenario's response contains an object that validates against that schema and has that value at that path, so a different resource with the same field cannot stand in.
- **Every scenario does what it says**: right status, right `errorCode` (required whenever `errorCodeOf` can read a code from the response), no contract violation, no fallback to examples, no handler error. A scenario that is not header-triggered may not force its outcome (no `X-Mock-Scenario` in its request, and its response must not report a forced scenario or fault), so it really exercises the handler. Only header-triggered and built-in scenarios can be forced at all; asking to force any other returns 400 with the runtime code `mock_scenario_not_forceable`, which `errorBody` maps onto the contract's own code.
- **Responses are reproducible**: each scenario runs in two fresh sessions with frozen clocks and must return byte-identical bodies, apart from the session id and signature inside signed provider and file links; seed data must be identical when created at different moments.
- **Sessions are isolated**: clock and armed scenarios always; state whenever some scenario changes state (otherwise that test is skipped, and the report should say so).
- **Webhook payloads match the contract** for every trigger.
- **The documentation is complete and valid**: `/__mock/openapi.json` is still a valid OpenAPI document, points "Try it out" at the mock, and lists every scenario (with a `curl` command) and every generated check under its own operation; `/__mock/docs` pins Swagger UI by version and integrity hash, under a content security policy that allows scripts only from that one file and the page's nonce. The tests do not load Swagger UI in a browser; step 6 of SKILL.md covers that.
- **The control plane is locked down**: every session and global operation needs a token, wherever the request comes from, and tokens are generated and saved when none are configured; a shared instance refuses to start without explicit tokens; browser requests from other websites are refused, including through percent-encoded or doubled paths, and never get CORS credentials; saved browser credentials count only on same-origin requests; webhook targets on this machine's loopback need the admin token; invalid settings stop the server at startup.
- **Browser apps can read the headers they need**: CORS exposes the mock's headers, every response header the spec documents, and `domain.exposeHeaders`.
- **Each scenario reaches the operation it covers**: responses carry `X-Mock-Operation`, and the test checks it against the scenario's `operationId`.
- **The tests use the mock's real defaults**: inherited `MOCK_*` settings from the shell are cleared before they run. As a consequence, verification does not exercise a project's own `.env` settings; the live checks in SKILL.md step 6 do.

It does not prove that the spec describes the real API correctly, that personas cover every combination a client might meet, or that state fields with other names, or enums defined only inline under `paths`, are covered; review those by hand. A `covers` proof is only as strong as its schema: for a schema with no required properties, or one that allows undeclared properties, another resource could satisfy it, and the coverage output lists such schemas as notes. Say so when reporting.

### Documentation page

`docs.ts` serves `/__mock/openapi.json`, a copy of the bundled spec with `servers` pointed at the mock (as a relative URL, so "Try it out" reaches whichever host served the page), the personas and controls added to `info.description`, and each operation's scenarios, generated checks, and `curl` commands appended to its `description`. `curl` commands use `MOCK_PUBLIC_URL` if set, otherwise the requesting host. `/__mock/docs` renders it with Swagger UI loaded from `cdn.jsdelivr.net`, pinned to an exact version with Subresource Integrity hashes and served under a content security policy that allows scripts only from that exact file or with the page's nonce. Path- and operation-level `servers` are removed from the served copy (with a note in the description), because the mock serves everything under one base path. The `curl` examples reset the session first, use `$MOCK_SESSION` (and `$MOCK_CONTROL_TOKEN` where the control plane needs it), and the toolbar gives each browser its own session by default. Swagger UI's online validator is switched off, so the page makes no other third-party requests.

The catalogue tier (`/__mock/`, personas, scenarios, docs, openapi.json) is open when `MOCK_CATALOGUE_ACCESS=open` and needs the control or admin token when it is `token`. Tokens are accepted as headers, or as the password of HTTP Basic credentials on same-origin requests only (the mock's own origins are the requesting host and, if set, `MOCK_PUBLIC_URL`); a refusal is a 401 with a Basic challenge so a browser prompts for it. `/__mock` redirects to `/__mock/`, so every challenge comes from inside `/__mock/` and browsers keep the credentials to that path. `access.ts` explains how a request is judged local and which browser origins may call the control plane.

Upgrading Swagger UI: change `SWAGGER_UI` in `docs.ts` to the new version's URLs, set each integrity value to `sha384-` followed by the base64 SHA-384 of the file (`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`), and run `npm run check:docs-cdn` and `npm test`.

## 6. Changing the runtime

Prefer solving API-specific needs in `src/domain`. Change `src/core` only for something the template cannot express (for example, a non-JSON wire format, or a credential that arrives in the request body). When you do, keep the change general, keep the comments accurate, and run the full verification, because the tests exercise core behaviour.

Things that commonly need small, legitimate changes:

- **Base path**: derived from the spec's first `servers` URL; override with `MOCK_BASE_PATH`.
- **Content types**: `server.ts` parses JSON (including `+json`) and form-encoded bodies, and passes everything else through as text. Add a parser if the contract needs multipart.
- **Session from credentials**: if a client cannot send `X-Mock-Session`, `engine.ts` can derive a session id from the credential (for example, from a token suffix such as `mock_active.alice`). Document the convention in the README if you add it.

## 7. Other stacks

TypeScript is the default. Use another stack only when the user asks for one. Keep the same architecture whatever the stack: the spec as the validated source of truth for both 3.0 and 3.1; per-session state with an idle TTL; seeded personas with fixed credentials; a scenario registry with executable examples and error codes; built-in faults; the `/__mock` control plane with the same paths, headers, and access tiers (so client teams can move between mocks without relearning them); a freezable virtual clock; browsable documentation at `/__mock/docs` generated from the registry; a coverage check; and tests that execute every scenario twice. Reasonable equivalents are:

- **Python**: FastAPI with `openapi-core` for request and response validation, and `pytest`.
- **Go**: `net/http` or `chi` with `kin-openapi` (`openapi3filter`) for validation; check its 3.1 support for the spec in hand.
- **Kotlin or Java**: Ktor or Spring Boot with `swagger-request-validator` (Atlassian); check its 3.1 support for the spec in hand.
- **C#**: ASP.NET Core minimal APIs with `Microsoft.OpenApi.Readers` and a JSON Schema validator.

Library support for OpenAPI 3.1 changes over time; confirm it for the chosen library before relying on it, rather than trusting this list.

A stateless example-based mock (such as Stoplight Prism) is enough when the user only needs static responses for layout work. It cannot hold state, run journeys, or move time, so it does not meet the goal of this skill on its own.
