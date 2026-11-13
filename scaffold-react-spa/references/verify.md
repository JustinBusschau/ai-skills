# Verification

> Last reviewed: 2026-11-13. This file is a starting point, per operating
> principle 1 in `SKILL.md`, not a substitute for confirming anything
> version-specific against current docs.

A scaffolded project is not finished when the files are written. It is
finished when every command in it has been run and the results are known.
This is the checklist, in the order to run it.

## The rule

Run each command, read the output, and fix what fails. Do not report a check
as passing because the configuration looks right. Where a check below asks for
a temporary deliberate violation, make it, confirm the gate fails, remove it,
and confirm the gate passes again; a gate that has never been seen to fail may
not be wired up. If a command cannot be run in the current environment, say so
explicitly in the final report rather than implying it passed.

## Checklist

### Type checking and linting

- `npm run typecheck` passes. Then add a deliberate type error in a file under
  `src/` and confirm it fails, and do the same in `vite.config.ts` (or another
  node-side config) and in an end-to-end test file. If any of the three passes
  with the error in place, a project reference is missing or the script is
  checking an empty root config.
- `npm run lint` passes. Confirm type aware rules are active with a floating
  promise (an un-awaited async call in a component), and confirm `jsx-a11y`
  is active with an `<img>` that has no `alt`.
- Each in-repo check has a passing test with a good and a bad fixture, and at least one check is
  shown failing on real source (for example an `import.meta.env` read outside
  the env module).
- `npm run format:check` passes.
- No `any`, no suppression comments, and no loosened compiler options in the
  source.

### Unit and component tests

- `npm test` passes with a test count greater than zero.
- Coverage thresholds are enforced: temporarily raise one above the current
  figure and confirm the run fails.
- The required tests from `tooling.md` exist: a component test, a route-level
  test through the router, an API client test against MSW including an error
  response, and an env module test for a missing variable.
- An unmocked network request fails a test (MSW is set to error on unhandled
  requests). Confirm with a temporary test that calls an unmocked URL.
- The component-level axe helper fails on a deliberately broken component
  (for example a button with no accessible name), and the rules disabled at
  this layer are listed in one place with the reason.
- No `.only` or `.skip` is committed.

### Build and bundle

- `npm run build` succeeds and produces `dist/`.
- `npm run size` passes, and the budget is recorded in the tooling ADR.
- `npm run scan:secrets:dist` is clean. Confirm it bites: add a temporary
  `VITE_` variable holding a fake credential in a format Gitleaks detects,
  read it through the env module (Vite only inlines variables that code
  references, so an unreferenced one never reaches `dist/` and the test
  proves nothing), rebuild, confirm the scan fails, then remove both and
  rebuild.
- If a mock-auth `e2e` mode exists: `vite build` in production mode with the
  mock flag set fails, `vite build --mode e2e` writes only to `dist-e2e/`, and
  `dist/` is untouched by it.
- The Node version is inside Vite's supported range for the version the
  installer resolved, not only "current".
- Building leaves no untracked files that should have been ignored.

### End-to-end and page-level accessibility

- Install the browsers (`npx playwright install --with-deps chromium` at
  minimum) and run `npm run test:e2e:smoke`. It passes against `vite preview`
  of the production build. Then run the full suite in every configured
  browser if they can be installed, and say which ran.
- Every main flow named in the brief has a test, tagged `@smoke`, that starts
  from a deep link to a nested route.
- Every main route has a page-level axe scan, and it is shown to bite: add a
  temporary low-contrast text colour or an unlabelled form field on one route,
  confirm the scan fails, then remove it.
- The keyboard-only test passes and asserts focus moves on route change.
- The preview server runs with the same CSP as the host config, and the suite
  fails on a CSP violation console error. Confirm with a temporary inline
  `<script>` in `index.html`.
- Every `data-testid` used in a test exists in the source.

If the browsers genuinely cannot be installed (no network, or system
libraries missing and no permission to install them), say so plainly, run
`npx playwright test --list` to prove the suite at least compiles and is
discovered, and state that the real run is the user's first manual check.

### Deep links and hosting configuration

- With `vite preview` running, `curl` a nested route and confirm a 200 with
  the app shell. `vite preview` itself serves the app shell for a missing
  `/assets/nope.js`, which the real host should not, so either add a small
  preview middleware that returns 404 for missing files under `/assets/` (so
  the local behaviour matches the host) or assert the asset exclusion in the
  host config unit test, and say which in the report. The post-deploy check
  in CI confirms it against the real host.
- `dist/` contains none of the development-only markers (mock worker, mock
  auth, devtools), and the check is shown to bite (see `tooling.md`).
- The host config file parses (JSON or TOML parser) and contains the history
  fallback, the asset exclusion, the cache rules, and the security headers.
  The unit test over it passes, and it fails if you temporarily remove the
  CSP or add `'unsafe-inline'` to `script-src`.
- If the app is served under a base path, the end-to-end deep link test runs
  under that base path.
- On a host without header or rewrite control (GitHub Pages), replace the
  host config checks above with the ones in `decisions.md`: `dist/404.html`
  exists and matches `dist/index.html`, the built `index.html` carries the
  meta CSP without `frame-ancestors` or `unsafe-` in `script-src`, and
  `npm run dev` still starts (the meta CSP must not be in the source
  `index.html`).

### Security and dependency posture

- `npm run scan:secrets` is clean and is shown to bite (a fake credential in a
  scratch file, then removed).
- `npm run scan:deps` is clean, or remaining findings are recorded and
  triaged in writing rather than suppressed wholesale.
- `npm run scan:sast` is clean, with the secrets rule set included.
- `npm run scan:licences` runs against the committed allow list.
- `npm run sbom` generates a file.
- Every `import.meta.env.VITE_*` read in the env module has a matching name in
  `.env.example`, and no `VITE_` name suggests a secret.
- The deploy job exists, is marked blocked, and its README checklist names
  every secret and variable it reads.

### Consistency of the four decisions

Re-run the enforcement sweep from `decisions.md` now that all tooling is in,
since adding a package can quietly reintroduce a contradiction.

### Documentation

- The README scripts table matches the actual scripts, and each listed script
  runs.
- Five ADRs exist (hosting, router, server state, CI platform, tooling
  baseline), and the hosting ADR contains the sweep result.
- `AGENTS.md` states the env module rule, the API client rule, and the
  commands that must pass before a commit.
- `SECURITY.md` exists.
- `docs/accessibility.md` contains the manual procedure with an owner.
- `docs/compliance/web.md` exists (see `web-compliance.md`).
- The branch protection checks are documented and match the job names, and
  the report states whether they were applied or only documented.
- If the brief named a compliance target, the documentation says the
  automated tooling does not certify conformance.

## Final report

Write the handover in prose, covering:

1. What was scaffolded, and the versions the generator and installer actually
   chose.
2. The four decisions and the reasoning recorded for each.
3. Every check you ran and its result, grouping the passes and calling out the
   failures you fixed and the gates you proved bite.
4. What you could not run, stated plainly, with the reason.
5. What you deliberately left out, and what would trigger adding it.
6. The first three things a new contributor should read.

Do not pad the report. The reader wants to know what works, what does not,
and what they have to decide.
