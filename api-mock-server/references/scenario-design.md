# Designing personas, triggers, and scenarios

Read this before writing any domain code. The quality of the mock depends far more on how well the outcome inventory is built than on the handlers, because a client team can only test the states the mock can reach.

## Contents

1. Building the outcome inventory
2. Choosing a trigger for each outcome
3. Designing personas
4. Repeatable journeys
5. Time and asynchronous outcomes
6. Edge-case data
7. Cross-cutting behaviours to check for
8. Mirroring a real provider's sandbox conventions

## 1. Building the outcome inventory

Work through the contract and list every outcome a client must be able to handle. Sources, in order:

- **Documented responses.** Every status code on every operation. The coverage check enforces these, but find them yourself first so you understand why each exists.
- **State machines.** Every enum field that describes the lifecycle of a resource (status, state, stage, step, phase, verification, decision). Draw the transitions: which operation, time delay, or webhook moves the resource from one value to the next, and which transitions are forbidden. Every value needs a way to be reached, and every forbidden transition needs a response (usually 409 or 422).
- **Business rules in prose.** Limits, eligibility rules, cut-off times, "only when", "unless", "must not". Each rule implies at least one refusal outcome, often one the response table does not list separately (for example, two different 403 reasons with different error codes). List them by error code, not only by status, because clients branch on the code: every 4xx and 5xx scenario declares its `errorCode`, and the tests check it.
- **Conditional fields.** Fields present only in some states, nullable fields, optional arrays. Clients break on the absent or null variant more often than on the present one, so each variant should appear in at least one persona's data.
- **Journeys.** Multi-step flows the contract describes or implies (sign-up, onboarding, verification, checkout, password reset, account deletion). Each journey needs a happy path and a failure or abandonment at each step.
- **Asynchronous outcomes.** Anything decided later than the request (reviews, settlement, provisioning, expiry), and every webhook or event.

Put the result in the scenario registry (`src/domain/scenarios.ts`) and the persona list. If the inventory has more than about 30 outcomes, show the persona list and the trigger plan to the user before implementing, since restructuring personas later means rewriting seeds and scenarios.

## 2. Choosing a trigger for each outcome

Prefer triggers that need nothing mock-specific in the client, because the app team wants to exercise their real code paths, unchanged, against the mock. Choose in this order:

1. **default**: an ordinary valid request produces it (the happy path).
2. **persona**: authenticating as a seeded persona whose account is already in the right state. Best for anything that depends on who the caller is or what state their account is in.
3. **input**: a documented magic value in the request (a card token, a surname, an amount, an email address pattern). Best for per-request decisions, and for outcomes that should be reachable by any persona. Choose values that a client would never send by accident, and that pass the contract's own validation.
4. **state**: a sequence of earlier calls, optionally with a clock advance. Use it for transitions in a journey, and make sure each intermediate state is also reachable directly by a persona, so testers are not forced to replay the journey to reach step four.
5. **action**: a back-office event (`domain.actions`, run through `POST /__mock/actions/<name>`) for transitions the client cannot cause: underwriting decisions, completions, reviews. Use it as a setup step in the scenario that shows the resulting state (declare that scenario's trigger as `state`).
6. **header**: only through `X-Mock-Scenario` or `/__mock/arm`. Reserve this for outcomes that have no natural trigger: provider-side outages, rare race conditions, and errors the client cannot provoke. The built-in faults already cover 429, 500, 503, timeouts, dropped connections, and malformed bodies, so do not register domain scenarios for those unless the contract defines a specific body or header for them.

Every registered scenario must have an executable `request` (and `setup` or `advanceClockSeconds` where needed). Set `contentType: 'application/x-www-form-urlencoded'` or `'multipart/form-data'` on a request or step whose operation takes those bodies (OAuth token endpoints, document uploads); in multipart, `{ $file: { filename, contentType, content } }` sends a file part. Every setup step must succeed (2xx or 3xx) unless it declares `expectStatus`, so a journey only passes when each of its steps does what it is meant to; setup steps may call `/__mock` endpoints such as a persona reset. The test suite runs each one twice, in fresh sessions with frozen clocks, and fails if it does not produce the declared status and `errorCode`, if the response violates the contract, if it came from spec examples rather than a handler, if the two runs differ, or if the response does not contain the values its `covers` labels claim.

You do not need scenarios for 401 on secured operations, or for the validation status on operations with a required body or required query or header parameter: the runtime derives and tests those from the contract. Write a scenario for any other documented validation outcome (for example a 400 for an unknown cursor), since request validation alone cannot produce it.

## 3. Designing personas

A persona is a ready-made account in a specific state, seeded identically into every session with fixed, documented credentials.

- Create one persona per distinct account-level state a client must render: each lifecycle value, each eligibility condition, and each meaningful data shape (empty, one item, exactly one page, more than one page).
- Give personas descriptive ids (`kyc_rejected`, `active_many_payments`) and derive everything from the id: user id, email, token, and the ids of its resources. This makes the seed readable in `/__mock/state` and stable across runs.
- Credentials must be obviously fake: an email on a reserved test domain of the API's own name (for example `@mock.<api>.test`), a shared documented password, and a token or API key with a `mock_` prefix. A fixed token per persona lets a client skip sign-in entirely, which matters for testers reproducing a bug report.
- If the contract issues JWTs and clients may decode them (to read `sub`, `exp`, or roles), issue unsigned or locally-signed JWTs with the documented claims, rather than opaque strings, and record the signing choice in `ASSUMPTIONS.md`.
- Prove each state value with a scenario, not a claim: give the scenario that returns it (often a plain read as the right persona) a `covers` label `Schema.field=value`, or `Schema.path.to.field=value` for a nested field such as `Payment.refund.state=requested`. The coverage check lists every label it expects; the tests confirm that the scenario's response contains an object of that schema with that value, so a label cannot pass unless the outcome really happens.
- Seed data must be deterministic. Use fixed dates derived from a `SEED_EPOCH` constant, never `Date.now()`, and if bulk data is needed use `@faker-js/faker` with a fixed seed (`faker.seed(<number>)`) inside `createState()`. The tests create the seed twice, a moment apart, and fail if the two differ.

## 4. Repeatable journeys

A team must be able to run the same onboarding or sign-up journey many times without creating a new account by hand each time. Provide at least two of these, as fits the API:

- **Reset on sign-in.** A persona marked `resetOnSignIn: true` is re-seeded every time it signs in, so a tester can sign in as `new_user` and always start from the beginning. The sign-in handler implements this by calling `seedPersona` for flagged personas.
- **Repeatable sign-up addresses.** Any address on a reserved domain (for example `@fresh.mock.<api>.test`) always succeeds at sign-up, replacing an earlier account with the same address. Ordinary addresses behave as the real API would, including a 409 when repeated, so the duplicate path stays testable.
- **Per-run sessions.** Automated suites send a unique `X-Mock-Session` per run and never need to clean up; the session expires after its TTL.
- **Persona reset.** `POST /__mock/personas/<id>/reset` restores one persona mid-session.

If sign-up involves a verification step (email code, SMS one-time passcode, magic link), make the code deterministic and documented (for example, `000000` always succeeds and `999999` is always expired), and expose the last issued code or link through a `/__mock` endpoint or `GET /__mock/state`, because the client team cannot read a real inbox.

## 5. Time and asynchronous outcomes

- Use `mc.now()` for every timestamp and `mc.schedule(delayMs, label, fn)` for every delayed change. Scheduled changes run on the next request (or clock advance) after their virtual time and are visible in `GET /__mock/state` as pending.
- Each session's clock is live by default (real time plus any advances, so a client that simply waits sees the outcome arrive) or frozen (time moves only through `/__mock/clock/advance`, so every timestamp is reproducible). Automated suites should freeze it; the generated tests always do.
- Choose realistic delays (the real provider's documented timings if known) so a client polling at its normal interval sees the intermediate state, and testers who do not want to wait can call `/__mock/clock/advance`.
- Expiry belongs on the virtual clock too: tokens, one-time codes, quotes, holds, and sessions. Without it, the "expired" branch of the client is untestable.
- When the client opens a third-party page in a WebView (identity verification, card checkout, signing), serve it as a provider page (`references/runtime.md`, section 4) so the journey, including the redirect back to the app, is testable end to end.
- When the contract describes webhooks, emit them from the same scheduled function that changes the state, using `mc.emitWebhook`, so the webhook and a subsequent read always agree. Provide a `webhookTriggers` entry for each event type so it can be fired on demand. If the contract documents a signature scheme, implement it in `signWebhook` with a fixed test secret recorded in the README.
- If the API offers both polling and webhooks for the same change, make sure both observe the same transition at the same virtual time.

## 6. Edge-case data

Spread these across personas, so they appear in normal responses rather than only in special scenarios:

- Strings at their maximum documented length; names with apostrophes, hyphens, diacritics, and non-Latin scripts; right-to-left text; emoji.
- Every optional field absent in at least one record, and every nullable field null in at least one record.
- Numbers at boundaries: zero, the documented minimum and maximum, the smallest currency unit, amounts in a currency with no minor unit (such as JPY) or three minor units (such as KWD) if the contract permits them.
- Dates and times: start and end of month, leap day, and timestamps either side of a daylight-saving change.
- Lists: empty, one item, exactly one page, one more than a page, and many pages. Implement real cursor or offset pagination; never return a fixed page.
- Enum values the client might not expect yet, if the contract says enums are extensible (record this in `ASSUMPTIONS.md`).

## 7. Cross-cutting behaviours to check for

Implement each one the contract describes, because client teams rely on them and they are easy to forget:

- **Authentication lifecycle**: expired tokens (on the virtual clock), refresh, revocation on sign-out, and 401 versus 403.
- **Idempotency keys**: replaying a request with the same key returns the original response; the same key with a different body returns the documented conflict.
- **Optimistic concurrency**: ETags, `If-Match`, or version fields, with the documented 409 or 412.
- **Rate limits**: rate-limit headers on normal responses if documented; the built-in `fault.rate_limited` covers the 429 itself.
- **Filtering, sorting, and search**: implemented over the session state, not faked.
- **Partial updates**: PATCH merges as the contract specifies, and read-only fields are refused or ignored as documented.
- **Deletion**: soft or hard as documented, with subsequent reads returning 404 or 410.
- **File uploads**: accept the documented content types and size limits, store a reference in state, and serve a deterministic placeholder file on download.

## 8. Mirroring a real provider's sandbox conventions

When the mock stands in for a third-party provider that has, or will have, its own sandbox, check the provider's documentation for test conventions (test card numbers, magic amounts, test bank accounts, sandbox phone numbers, outcome-selecting names). Use exactly those values as the mock's `input` triggers. The client team's test suites will then work unchanged when they switch from the mock to the provider's sandbox. Record the source of each convention in `ASSUMPTIONS.md`, and where the provider has none, design values in the same style.
