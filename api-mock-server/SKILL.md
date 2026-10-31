---
name: api-mock-server
description: Builds a stateful, contract-validated mock server (TypeScript by default) from an API design document, whether an OpenAPI or Swagger YAML/JSON file, a Markdown contract, or a Word, PDF, or Google document, so app and web teams can develop against an API before its live or sandbox environment exists. Generates deterministic test data with seeded personas and fixed credentials, magic input values, and forced scenarios so that every documented response and every resource state can be reached from the client; makes onboarding and other journeys repeatable without creating new accounts; isolates state per session with a time limit and reset endpoints; and simulates delayed outcomes and webhooks on a virtual clock. Use whenever someone wants a mock, stub, fake, simulator, or stand-in backend for an API, wants to "unblock the app team" while a third-party provider's sandbox is unavailable, wants test users or test data covering every state or edge case of an API, or asks to turn an API spec or contract into something runnable, even if they do not say "mock server".
---

# API mock server

## What this produces

A runnable TypeScript project that stands in for a real API until its live or sandbox environment exists. Client developers point their base URL at it and their real code paths work unchanged. It is not a static example server: it holds state per session, enforces the contract in both directions, and can be driven into every outcome the contract documents.

The project contains:

- `spec/openapi.yaml`, the contract the mock enforces;
- a runtime (Fastify and Ajv, accepting OpenAPI 3.0 and 3.1) that validates every request, response, and webhook payload against the spec;
- seeded **personas**, each an account already in a specific state, with fixed credentials;
- a **scenario registry** that records how to reach each outcome (by persona, magic input, earlier calls, or a forcing header), with an executable example for each;
- a `/__mock` control plane for resets, a virtual clock, forced outcomes, webhook targets, and request logs;
- browsable documentation at `/__mock/docs`: Swagger UI over the spec, with every operation's test cases (how to trigger each outcome, its error code, and a ready-to-run `curl` command) written into it, and a toolbar that sets the session, persona, and forced scenario for "Try it out";
- a coverage check that fails when a documented response, state value, or webhook cannot be reached, and a test suite that executes every scenario twice to prove it is reachable, correct, and reproducible;
- `README.md`, `SCENARIOS.md` (generated), `ASSUMPTIONS.md`, a `Dockerfile`, and `.env.example`.

The template that provides the runtime is in `assets/template`; a complete worked example of a domain is in `assets/example-acme-wallet`.

## Workflow

### 1. Find and normalise the source

Ask for the source if it is not obvious. Then get to a single OpenAPI document, because the runtime validates against it and every later step depends on it:

- **OpenAPI file (3.0 or 3.1)**: use it directly. Swagger 2.0 must be converted to OpenAPI 3 first (for example with `npx swagger2openapi`). The project's `npm run check:spec` validates it once scaffolded; fix only structural errors that would stop the mock loading, and report anything else rather than silently changing the contract.
- **Markdown contract**: hand off to the `api-contract-to-openapi` skill if it is available, since it carries the fidelity rules for that conversion. If it is not, follow the same principle: mirror field names, enums, and casing exactly, and do not add endpoints or fields the document lacks.
- **Word, PDF, PowerPoint, or Google document**: convert to Markdown first with the `doc-to-markdown` skill if available (otherwise `pandoc` or the relevant document skill), then treat it as a Markdown contract.
- **A third-party provider's public documentation**: if the provider publishes an OpenAPI file, use that rather than transcribing their pages. Note the version or date you used.

Read the whole source before going further. While reading, collect everything that is missing, ambiguous, or contradictory (an undocumented error body, an enum whose values are only implied, an asynchronous step with no stated timing). Resolve each with the most reasonable reading and record it in `ASSUMPTIONS.md` with the quote or section it relates to. Ask the user only about the ones that would change what client teams build against; a mock that guesses silently teaches clients the wrong contract.

### 2. Settle the few things that cannot be derived

Ask, in one message, only what is not already clear:

- **Where the project should go**, and its name. Default to a sibling directory named `<api>-mock`.
- **Who will run it**: each developer locally, or one shared instance for a team or CI. The control plane always needs a token. On a local mock the tokens are generated at first start, printed, and saved in `.mock-tokens`, so developers need do nothing beyond reading the startup output. Anything bound beyond loopback is a shared instance: it refuses to start unless given `MOCK_ADMIN_TOKEN` and `MOCK_CONTROL_TOKEN`, and delivers webhooks only to hosts listed in `MOCK_WEBHOOK_ALLOWED_HOSTS`. For a shared instance, tell the user they will need to choose and distribute those two tokens, and which hosts (if any) should receive webhooks.
- **Whether the documentation and catalogue need the control token.** `/__mock/docs`, `/__mock/openapi.json`, `/__mock/personas`, and `/__mock/scenarios` show every persona's credentials. They are fake, but some teams still do not want them readable by anyone who can reach the server. Ask; the answer sets `MOCK_CATALOGUE_ACCESS` (`open`, the default, or `token`) in `.env.example`, `.env`, and the README's Docker command. With `token`, browsers prompt for the control token. It can be changed later without rebuilding.
- **Whether a real provider sandbox will follow**, and if so whether it has documented test conventions (test card numbers, magic amounts, sandbox phone numbers). If it does, the mock must use exactly those values so client test suites carry over unchanged (see `references/scenario-design.md`, section 8).

Use TypeScript unless the user explicitly asks for another stack. If they do, read `references/runtime.md`, section 7, and keep the same architecture and control-plane paths.

Do not initialise a git repository, create branches, or commit unless the user asks.

### 3. Build the outcome inventory and persona plan

Read `references/scenario-design.md` now. It explains how to enumerate outcomes (documented responses, state machines, business rules, conditional fields, journeys, asynchronous outcomes), how to pick a trigger for each, how to design personas and repeatable journeys, and which edge-case data and cross-cutting behaviours to include.

The governing idea: an outcome is only testable if a client developer can reach it on purpose and repeat it. Prefer triggers that need nothing mock-specific in the client (a persona's credentials, a documented magic value) over forcing headers, because the app team wants to test their real code paths. Keep forcing headers for outcomes nobody can provoke naturally, such as provider outages.

For a large API (roughly 30 outcomes or more), show the user the persona list and the trigger plan before implementing, because restructuring personas later means rewriting the seed and the scenarios.

### 4. Scaffold the project

The project needs Node.js 22.13 or later on the 22 line, 24, or 26 or later (`node --version`); npm refuses to install on other versions, including 23 and 25. If the machine has an unsupported version, tell the user before going further.

```bash
bash <skill-dir>/scripts/scaffold.sh <target-dir> <project-name> "<API title>" <path-to-spec>
cd <target-dir>
npm install
npm run bundle:spec   # only if the scaffold said the spec references other files
npm run gen:types
```

The script refuses to write into a non-empty directory, and stops if the target path cannot be created. If the spec `$ref`s other files, it copies them into `spec/source/`, and `npm run bundle:spec` builds the single `spec/openapi.yaml` the mock reads. Keep the `package-lock.json` that `npm install` writes: the Docker image installs from it, so the image runs exactly the versions that were tested. After installing, run `npm outdated`; if a dependency has a newer major version, try it and keep it only if `npm run verify` still passes at step 6. Settings go in environment variables or `.env` (loaded automatically; the shell wins). Fill in the placeholders `__SOURCE_NOTE__` (in `README.md` and `ASSUMPTIONS.md`), one sentence naming the source document and its version or date, and `__BASE_PATH__` in `README.md` (the path of the spec's first server URL, such as `/v1`, or nothing).

If the spec's `servers` URL has a path, the runtime uses it as the base path automatically. If the spec uses `/__mock` for anything, stop and ask, since that prefix is reserved for the control plane.

### 5. Implement the domain

Read `references/runtime.md` for the request pipeline, the handler API, and the `Domain` interface, and read the corresponding files in `assets/example-acme-wallet/domain` as a model. Then replace the skeleton files in `src/domain`:

1. `state.ts`: the resources the API manages, as plain JSON-serialisable records.
2. `personas.ts`: the personas from step 3, with `seedPersona()` and a deterministic `createState()`.
3. `handlers/`: one handler per operation, grouped by resource or tag, mapped by `operationId` in `handlers/index.ts`. A handler receives the validated request (`req.params`, `req.query`, `req.body`) and the session context. Implement real behaviour over session state: creation, reads, updates, deletion, filtering, sorting, and pagination as the contract describes.
4. `scenarios.ts`: one entry per outcome in the inventory, each with an executable `request` and, where needed, `setup` and `advanceClockSeconds`. Every entry whose response is the contract's error envelope declares its `errorCode` (a documented non-envelope body, such as a 422 business outcome, needs none), and every state value is claimed through a `covers` label on the scenario whose response shows it.
5. `index.ts`: credential resolution, the exact error envelope (`errorBody` to write it, `errorCodeOf` to read it back), the validation status, and any webhook triggers, contract mappings, or signature scheme.

Hold to these rules, because each one protects something the client team relies on:

- **The contract wins.** Return only what the spec allows. Do not add endpoints, fields, or enum values to the API surface; anything mock-specific belongs under `/__mock` or in `X-Mock-*` headers. If a handler cannot satisfy the contract, the response validator will turn it into a visible 500, which is the intended outcome; fix the handler, or record the contract gap in `ASSUMPTIONS.md`.
- **Reproducibility.** With a frozen clock, the same requests in a fresh session produce byte-identical responses; the tests check this for every scenario. Use `mc.now()` and `mc.schedule()` rather than `Date.now()` or timers, derive seed dates from a fixed epoch, anchor seed data described relative to "today" ("issued 3 days ago", "due in 5 days") to `mc.session.startedAt` rather than `mc.now()` so that advancing the clock moves time past it, generate ids from a counter in state, and seed any random generator. (A live clock follows real time, so timestamps then differ between runs by design.)
- **Implement every operation.** An operation without a handler is answered from spec examples and marked `X-Mock-Source: spec-example`. The coverage check fails for any operation without a handler, or whose handler no scenario reaches (a scenario forced by header does not count), so an unimplemented operation needs an explicit exemption, which you must report.
- **Headers a browser must read.** A browser app can read only the response headers CORS exposes. The spec's documented response headers and the mock's own `X-Mock-*` headers are exposed automatically; list any other header a handler sets (such as a link to a provider page) in `domain.exposeHeaders`.
- **Realistic identifiers and data.** Match the spec's formats and patterns for ids, dates, currency amounts, and phone numbers. Spread the edge-case data from `references/scenario-design.md`, section 6, across personas.
- **No real data or secrets.** Credentials are obviously fake and documented. Do not copy names, emails, tokens, or keys that look real from the source document; flag any you find to the user.
- **Keep magic values in one place.** Export trigger values and delays as constants beside the handler and import them into `scenarios.ts`, so the catalogue cannot drift from the behaviour.

### 6. Verify

```bash
npm run verify
```

This checks the spec, regenerates types, type-checks, runs the coverage check, runs every scenario and generated check, checks webhook payloads, session isolation, and the shared-instance access rules, and regenerates `SCENARIOS.md`. All of it must pass before you report the mock as working. `references/runtime.md`, section 5, lists exactly what a pass does and does not prove; do not claim more than that.

When the coverage check reports a gap, add the persona, input, or scenario that reaches it. Use `coverageExemptions` only for an outcome you have decided not to simulate, with a reason the user would accept, and list every exemption in your report. Copy every `note` line from the coverage output (statuses the mock sends that the contract does not document) into `ASSUMPTIONS.md`. If the test named "state changes stay in their session" was skipped, say so: it means no scenario changes state, so state isolation was not exercised.

Then start the server (`npm run dev`), note the control token it prints (or read `.mock-tokens`), and check it as a client would, with `curl`, sending the token as `X-Mock-Control-Token` on `/__mock` calls: one happy path, one persona-driven state, one magic-input outcome, a clock advance that completes an asynchronous change, `POST /__mock/reset`, a CORS preflight (`OPTIONS` with an `Origin` header), `GET /__mock/scenarios`, and `GET /__mock/docs` (expect HTML) and `/__mock/openapi.json`. If network access is available, run `npm run check:docs-cdn` to confirm the pinned Swagger UI files still match their integrity hashes; if a headless browser is available, load `/__mock/docs` and confirm Swagger UI renders the operations rather than the fallback message. Say which of these you could not run. Stop the server afterwards. Tests that use `inject()` do not exercise the network stack, CORS, `.env` loading, or startup configuration, so this step catches a different class of problem.

If the user wants a shared instance and Docker is available (`docker info` succeeds), build the image, run it with throwaway tokens, confirm it serves a request and rejects `GET /__mock/state` without the control token, then stop the container and remove the image. If Docker is not available, say that the image was not built or tested.

### 7. Write up and report

Complete `ASSUMPTIONS.md` and check the README reads correctly for this API (remove sections, such as webhooks, that do not apply). Then tell the user, briefly:

- how to start the mock, the base URL to point clients at, `/__mock/docs` as the place to browse every test case, and where the control token comes from (printed at first start and saved in `.mock-tokens`, or the value they chose);
- the personas and the main magic inputs (point to `SCENARIOS.md` for the full list);
- the assumptions that most affect client behaviour, and any questions still open;
- any coverage exemptions, undocumented statuses the mock sends, unimplemented operations, skipped tests, or verification steps that did not pass or were not run (such as the Docker build), stated plainly.

## Updating an existing mock

When the spec changes, replace `spec/openapi.yaml`, run `npm run verify`, and work through the failures: type errors show handlers out of step with schemas, coverage gaps show new outcomes, and contract violations show responses that no longer match. Update personas and scenarios to match, and add the change to `ASSUMPTIONS.md` if it resolves or creates an assumption. Before overwriting any file the user may have edited by hand, look at it and preserve their changes.

To move an existing mock onto a newer version of this skill's runtime, compare its `src/core`, `scripts`, `test`, and `package.json` with `assets/template`, copy the template's versions across (keeping any deliberate local changes to `src/core`, which section 6 of `references/runtime.md` asks to be kept general and commented), adapt `src/domain` to any interface changes the type-checker reports, and run `npm run verify`.

## Reference files

- `references/scenario-design.md`: building the outcome inventory, choosing triggers, personas, repeatable journeys, time and webhooks, edge-case data, cross-cutting behaviours, and provider sandbox conventions. Read at step 3.
- `references/runtime.md`: template layout, request pipeline, handler API, the `Domain` interface, when to change the runtime, and other stacks. Read at step 5.
- `assets/example-acme-wallet/`: a complete domain for a small spec (`openapi.yaml`), with its generated `SCENARIOS.md`.
- `scripts/scaffold.sh`: copies the template, fills its placeholders, and (through `scripts/copy-spec.cjs`) copies the spec with exactly the files it references; on failure it leaves the target as it found it.
