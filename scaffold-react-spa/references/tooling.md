# Tooling baseline

> Last reviewed: 2026-11-13. The specific tool names, package choices, and
> "current" behaviour mentioned below were correct at that time. Confirm each
> one against current docs or `--help` before relying on it; this file is a
> starting point, per operating principle 1 in `SKILL.md`, not a substitute
> for checking.

This is the pragmatic minimum: mainstream, maintained, free, and sufficient to
satisfy a reviewer asking where the linting, the tests, the accessibility
coverage, and the security controls are. Each section states the default, the
reason, and what to leave out.

Two rules govern the whole file. First, no version numbers appear here:
resolve each package at install time and record what you got. Second, a tool
is only part of the baseline once it has a script in the manifest and a job in
CI.

## Contents

- Runtime and package management
- TypeScript
- Environment variables
- Linting, including the in-repo checks
- Formatting
- Git hooks
- Unit and component testing
- End-to-end testing
- Accessibility testing
- Security headers and the Content Security Policy
- Static analysis and supply chain
- Bundle size budget
- Browser support
- Deliberately not in the baseline
- Wiring it up

## Runtime and package management

**Default: the current Node LTS, npm, a committed lockfile, `npm ci` in CI.**

- Pin the Node version in `.nvmrc` (or `.node-version`) that CI reads, and
  repeat it in the manifest's `engines` field. Two sources that disagree are a
  support ticket waiting to happen.
- Commit the lockfile. CI installs with `npm ci`, never `npm install`.
- Cache the package manager's download cache in CI, keyed on the lockfile
  hash.
- `npm audit` is a floor, not a strategy; dependency scanning below adds a
  second source.

If the input or an existing repository already uses pnpm or yarn, use it
without hesitation and translate every command in this skill.

## TypeScript

**Default: `strict` on, `allowJs` off, a type check that genuinely checks every
project, type aware linting.**

The Vite React TypeScript template generates a solution-style root
`tsconfig.json` that references an app config and a node config. That layout
is fine, but it creates two traps:

1. Running `tsc --noEmit` at the root checks nothing, because the root config
   has no files of its own. Use `tsc -b` (build mode, which follows the
   references and, with `noEmit` in each referenced config, emits nothing), or
   run `tsc --noEmit -p` against each referenced config. Prove it works in
   verification by adding a deliberate type error to `src/`.
2. Strictness must be set in every referenced config, not only the app one,
   because `vite.config.ts` and the Playwright and Vitest configs are code
   too.

In each referenced config:

- `strict: true`, never relaxed per file.
- `allowJs: false`.
- `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noUnusedLocals`, and `noUnusedParameters`.
- `verbatimModuleSyntax` and `isolatedModules`, which the template usually
  sets already because the bundler transpiles files one at a time.
- `forceConsistentCasingInFileNames`.
- Include the application source, the test source, and the end-to-end
  source (in the node config, or a third referenced config for Playwright if
  that is cleaner). Every TypeScript file in the repository must be covered by
  exactly one project, or it is never type checked.

**Enforcement:** a `typecheck` script, run as its own CI job and in the
pre-commit hook if it is fast enough. Type errors are never resolved with
`any`, a suppression comment, or a looser config.

**Type aware linting** requires Oxlint's `--type-aware` mode with
`oxlint-tsgolint` installed (or, on the ESLint alternative, typescript-eslint's
project service). Without it, the type-aware rules silently do nothing.

## Environment variables

Vite exposes variables prefixed with `VITE_` to client code and inlines their
values into the built JavaScript. Every visitor can read them.

- Create `src/env.ts` that reads `import.meta.env`, validates the required
  variables at start-up with a schema (for example the validator the project
  already uses, or a few lines of hand-written checks), and exports a typed,
  frozen object. Fail loudly at start-up with the variable name, not later
  with `undefined` in a URL.
- Augment `ImportMetaEnv` in a `vite-env.d.ts` (or the file the template
  generated) so that every variable is typed.
- `.env.example` lists every name with a placeholder and a one-line comment.
  Commit it. Gitignore `.env.local` and `.env.*.local`. The `.env` and
  `.env.<mode>` files may be committed only if they contain nothing but
  public, non-sensitive defaults; say so in a comment at the top of each.
- In the README, state in plain words that `VITE_` values are public.

### Keeping development code out of the build

Mock Service Worker's browser worker, mock sign-in providers, fixture data, and
router and query devtools must never reach `dist/`. Import each of them only
dynamically (`await import(...)`) inside a branch guarded by a literal
`import.meta.env.DEV` (or a literal `import.meta.env.MODE` comparison), and
add a CI step after the build that searches `dist/` for a marker string from
each (for example the MSW worker file name and a unique string in the mock
auth module) and fails if one is found. Prove the step bites by temporarily
importing a mock statically.

## Linting

**Default: Oxlint, as `create-vite` now generates for React templates, with
its correctness rules, the TypeScript, React, React hooks, `jsx-a11y`,
Vitest, import, and promise plugins, type-aware rules through
`oxlint-tsgolint`, and a small set of in-repo checks.**

Why Oxlint rather than ESLint: as of the last review, `create-vite` defaults
React templates to Oxlint and TypeScript 7; typescript-eslint does not yet
support TypeScript 7; and the original `eslint-plugin-jsx-a11y` supports only
ESLint majors that are now end of life. Oxlint implements the `jsx-a11y`, React,
and hooks rules natively and runs type-aware rules through `oxlint-tsgolint`,
which follows the TypeScript 7 line. Confirm all of this against current
`npm create vite@latest -- --help`, `npx oxlint --help`, and the Oxlint docs
before relying on it. If the landscape has changed (for example
typescript-eslint now supports the TypeScript major the template installs, and
the user or an existing repository prefers ESLint), ESLint with typescript-eslint
and a maintained `jsx-a11y` plugin is an acceptable alternative; record the
choice in the tooling ADR. Never end up with both linters.

- Start from the `.oxlintrc.json` the template generates and extend it. Do
  not hand write the configuration of a linter the template did not
  generate.
- Enable the plugins above in the config file, not only on the command line,
  so editors and CI agree. Turn on the `correctness` and `suspicious`
  categories as errors.
- Type-aware rules: install `oxlint-tsgolint`, run with `--type-aware`, and
  enable at least no floating promises, no misused promises (an `async`
  handler passed to `onClick` without handling the rejection), and no
  unnecessary conditions, plus no explicit `any`. Prove they are active in
  verification; a type-aware rule that silently does not run is the classic
  audit gap.
- `jsx-a11y` is not optional: accessibility matters to almost every user of
  almost every app, and lint is the cheapest layer that catches it. Enable
  its recommended rules as errors. If a version conflict ever threatens it,
  resolve the conflict rather than dropping the plugin.
- React: the hooks rules (including any React Compiler rules if the project
  enables the compiler), and the React Refresh "only export components" rule
  so hot reload works.
- A rule that fails on `.only` and `.skip` in committed tests (the Vitest
  plugin's, or the in-repo check below for Playwright files).
- The lint script fails on warnings as well as errors (`--deny-warnings`), or
  uses a tracked `--max-warnings` budget. Never an unbounded pile.
- Oxlint does not format, so it does not fight Prettier.

### The in-repo checks

These cover what the plugins do not. Prefer Oxlint's JavaScript plugin support
(`jsPlugins` in `.oxlintrc.json`) if the current docs describe it as stable;
otherwise write each as a small Node script under `scripts/checks/` that parses
the source (with the TypeScript compiler API or `oxc-parser`, not a regular
expression, for checks 1 to 3), run them all from a `lint:custom` script that
`lint` calls, and give each a unit test with a passing and a failing fixture.
Keep them in the repository so they are auditable and add no supply chain
surface. Keep the set small:

1. `import.meta.env.VITE_*` (or `import.meta.env` indexed dynamically)
   accessed anywhere other than the typed env module. Literal
   `import.meta.env.DEV`, `import.meta.env.PROD`, and `import.meta.env.MODE`
   checks are allowed anywhere, and are in fact required where they guard
   development-only code (see "Keeping development code out of the build"
   above), because Vite only removes dead branches when the condition is a
   literal it replaces at build time. A value re-exported from the env module
   is not literal, so a branch guarded by it stays in the bundle.
2. `fetch(` called anywhere other than the API client module.
3. `dangerouslySetInnerHTML` used without passing the value through the
   project's sanitiser function, or used at all if the app has no sanitiser.
4. Writes to `localStorage` or `sessionStorage` whose key or variable name
   suggests a token, password, or personal data. This is a naming heuristic,
   not taint analysis; describe it honestly as a complement to review, not a
   control in itself.
5. `console.log` in application source outside a logger module (Oxlint's
   `no-console` with an override for the logger file is enough here).
6. `data-testid` values that do not follow the naming convention (see
   end-to-end testing below), so selectors cannot drift.
7. `test.only`, `test.skip`, `describe.only`, and `describe.skip` in
   Playwright files, if no enabled plugin rule already covers them.

## Formatting

**Default: Prettier with its defaults, an import sorter, and a format check
that fails CI.**

- Prettier with no configuration beyond what the project genuinely needs.
- An import sorting plugin. Check the current recommended plugin before
  choosing, as this space churns.
- Two scripts: `format` (write) and `format:check` (check). CI runs the
  check.
- Ignore generated files (`dist/`, coverage, Playwright reports, a generated
  route tree, generated API types).

## Git hooks

**Default: Husky plus lint-staged, with a pre-commit hook running the fast
subset.**

On staged files only: the format check, the linter, and a secret scan with
Gitleaks. Also the type check if it completes in a few seconds. The full test
suite belongs in CI, because a hook that takes thirty seconds is a hook
developers disable.

Gitleaks, Semgrep, and OSV-Scanner are not npm packages, so `npm ci` does not
install them, and every contributor's machine is different. Handle that
explicitly rather than leaving each contributor to discover it:

- List them in the README prerequisites with the install command for macOS,
  Windows, and Linux.
- Add a `doctor` script (`npm run doctor`) that reports which of them are
  missing, and mention it in the README's first-run steps.
- In the pre-commit hook, if `gitleaks` is missing, stop the commit with a
  one-line message naming the install command and `npm run doctor`. Do not
  skip the scan silently, because that makes "secrets are caught before they
  enter history" false on exactly the machines nobody checks, and do not
  teach people `--no-verify`, which also skips lint and format.
- In CI, run each tool from its released binary or official container image,
  pinned by version and checksum or digest, so CI never depends on what a
  runner happens to have.
- If Gitleaks cannot be installed on the machine you are scaffolding on, say
  so in the final report and treat it as a gap, as for any other command
  that could not be run.

Add a commit message convention only if the user asks for one.

## Unit and component testing

**Not optional. This is the layer that must always exist.**

**Default: Vitest, React Testing Library, `@testing-library/user-event`,
`@testing-library/jest-dom` matchers, jsdom (or happy-dom), and Mock Service
Worker.**

- Vitest shares the Vite config and transform pipeline, so test and build
  resolve modules the same way. Configure it in `vite.config.ts` (or a
  `vitest.config.ts` that merges it); do not duplicate aliases.
- Pick jsdom or happy-dom once and record why. jsdom is the more complete
  implementation and the safer default for accessibility checks.
- A setup file registers the jest-dom matchers, starts the MSW server with
  `onUnhandledRequest: 'error'` (so an unmocked request fails the test instead
  of silently hitting the network), resets handlers after each test, and
  cleans up. Keep global mocks to a minimum and note why each exists.
- Test helpers: a `renderWithProviders` (router at a given URL, a fresh
  `QueryClient` if decision 3 chose TanStack Query, and any theme provider) so
  every test renders the component the way the app does.
- Prefer queries by role and accessible name, and `user-event` over
  `fireEvent`. These are also accessibility assertions in disguise: if a test
  cannot find a button by its name, neither can a screen reader user.
- Avoid snapshot tests of rendered markup; they fail for reasons unrelated to
  behaviour.
- Colocate tests next to the source (`*.test.tsx`) or use a mirrored
  directory. Pick one.
- Coverage with the V8 provider, with thresholds in the config, enforced in CI
  from the first commit. Set the initial floor to what the scaffold actually
  achieves rather than an arbitrary eighty percent, say in the README that it
  is a floor that ratchets up, and add a check that warns when actual coverage
  exceeds the floor by a large margin (for example twenty points), so a stale
  floor is visible. Exclude generated files, `main.tsx`, type declarations,
  and test helpers from coverage, and say so in the config.

Required tests in the scaffold: at least one component test, one route-level
test that renders a page through the router, one test of the API client
against MSW (including an error response), and one test of the env module
failing on a missing variable.

## End-to-end testing

**Required for the main user flows. Explicitly not required for every page,
and the README should say so, so nobody treats the absence of a test as a
defect.**

**Default: Playwright Test, run against `vite preview` of the production
build.**

- Use `npm init playwright@latest` (confirm the current command) or install
  `@playwright/test` and write the config by hand after reading the current
  docs. TypeScript only.
- `webServer` in the Playwright config runs only `vite preview` on a fixed
  port, against a `dist/` that already exists, with `reuseExistingServer` off
  in CI. The `test:e2e` scripts build first (`npm run build && playwright
  test`), so a local run is self-contained, while CI runs `playwright test`
  directly against the downloaded job 4 artefact, which keeps "the bytes we
  tested are the bytes we deploy" true. Never run the suite against the dev
  server, which serves a different module graph from the one you ship.
- Projects: Chromium for the pull request smoke run; Chromium, Firefox, and
  WebKit for the nightly full run. Add a mobile viewport project if the brief
  mentions phones.
- Locators by role and accessible name first, then by label or text, and
  `data-testid` only where there is no accessible handle. Where `data-testid`
  is used, it follows a convention (for example `area-element-purpose`)
  enforced by the in-repo rule, and every one used in a test exists in the
  source.
- API calls are mocked at the network layer with Playwright's `page.route`, or
  the tests run against a real test environment whose URL comes from an
  environment variable. Pick one per suite and record it. Never point the
  suite at production.
- Tag main-flow tests `@smoke` (in the title or with Playwright's tag
  option). The pull request run uses `--grep @smoke`.
- Authentication: where a test tenant exists, use Playwright's storage state
  set-up project, with test credentials from CI secrets, never committed.
  Where it does not (the usual case at scaffold time), build a separate
  end-to-end bundle with `vite build --mode e2e` in which a mock auth
  provider replaces the real identity library, guarded by a literal
  `import.meta.env.MODE === 'e2e'` check. Give that mode its own output
  directory (`build.outDir: 'dist-e2e'` for mode `e2e`, and gitignore it), so
  it can never overwrite `dist/` and be deployed or scanned by mistake, and a
  second Playwright project or config that previews `dist-e2e/` on its own
  port. Run the signed-in main flows
  against that bundle, and run the signed-out path (deep links, the redirect
  to sign-in, headers, and page-level axe) against the real production
  bundle. Make the production build fail if the mock auth flag is set, prove
  the `dist/` marker check above catches the mock, and say plainly in the
  report that the real sign-in flow is untested until a test tenant exists.
- Libraries that compile code at runtime with `eval` or `new Function` break
  under `script-src 'self'`. Zod's fast path is one: configure it in its
  jitless mode (confirm the current option name) rather than loosening the
  CSP. If another library needs `unsafe-eval`, replace the library.
- WebKit on macOS does not move focus to links with Tab by default (it
  mirrors Safari's setting). Make the keyboard-only test choose its key by
  platform as well as browser (Alt+Tab only when the browser is WebKit and
  `process.platform === 'darwin'`), because CI runs WebKit on Linux, where
  plain Tab may be correct. Confirm the Linux behaviour in the first nightly
  run and record it next to the code.
- Every main flow gets a test that starts with a deep link (loading the
  nested URL directly), because a broken history fallback is the most common
  production-only SPA failure.
- Traces on first retry, screenshots and video on failure, and the HTML report
  uploaded as a CI artefact even when the job fails.
- Retries: zero locally, a small number in CI. A test that needs more than one
  retry is a defect to fix, not a number to raise.
- Install browsers with `npx playwright install --with-deps <browsers>` in CI,
  and cache the browser directory keyed on the Playwright version.

A flows list in the README names the main flows and the reasoning, which is
the artefact that makes "required for main flows" auditable.

## Accessibility testing

**Required. Four layers, because no single tool covers it.**

### Layer one: static rules

`jsx-a11y` in the lint config, on every commit.

### Layer two: component-level axe

Use axe-core in Vitest (through `vitest-axe` or `jest-axe` if either supports
the current Vitest major; otherwise call `axe-core` directly with a small
helper and matcher). Run it on every component test that renders a meaningful
piece of UI. jsdom does not compute layout or colour, so colour contrast and
some visibility rules cannot be checked at this layer; disable only those
rules here, in one documented place, and rely on layer three for them.

### Layer three: page-level axe in a real browser

Use `@axe-core/playwright` in the end-to-end suite. For every main route,
after it has loaded and settled, run an axe scan with the WCAG tags that
match the brief's target (for example `wcag2a`, `wcag2aa`, `wcag21aa`,
`wcag22aa`; confirm the current tag names in the axe-core docs) and fail on
any violation. This is the layer that catches contrast and focus problems,
because it runs in a real browser. Also add one keyboard-only test of the main
flow: complete it with `Tab`, `Shift+Tab`, `Enter`, and `Space` only, and
assert that focus is visible and that focus moves to the main heading or main
landmark after each route change (SPAs commonly forget to manage focus on
navigation, which leaves screen reader users stranded).

If an axe rule must be excluded for a specific element, scope the exclusion
with `exclude` on that selector and write the reason next to it. Never disable
a rule for the whole page.

### Layer four: manual procedure

Automated checks find perhaps a third to a half of real accessibility
problems. Write a short manual procedure in `docs/accessibility.md`:

- Keyboard-only completion of every main flow, with visible focus throughout.
- A screen reader pass with at least one pairing (NVDA with Firefox or Chrome
  on Windows, or VoiceOver with Safari on macOS), checking landmarks, headings,
  route change announcements, form errors, and live regions.
- 200% browser zoom and 400% zoom (reflow at 320 CSS pixels wide) without loss
  of content or horizontal scrolling.
- Reduced motion and forced colours (Windows high contrast) checks.
- A named owner and a release gate.

If the brief names WCAG 2.2 AA or a legal obligation, state plainly in the
README that the automated layers narrow risk and do not certify conformance.

## Security headers and the Content Security Policy

**Default: a strict CSP and the standard headers, configured at the host,
tested in CI and checked after deploy.**

- Start from `default-src 'self'`; `script-src 'self'`; `style-src 'self'`
  (add `'unsafe-inline'` for styles only if the chosen styling approach truly
  needs it, and record why); `img-src 'self' data:`; `connect-src 'self'` plus
  the API and identity provider origins from the typed env module;
  `frame-ancestors 'none'` unless the brief says the app is embedded;
  `base-uri 'self'`; `form-action 'self'`; `object-src 'none'`.
- Vite's production build emits no inline scripts by default, so
  `script-src 'self'` works. Never add `'unsafe-inline'` or `'unsafe-eval'` to
  `script-src`. If a third-party script is genuinely required, add its exact
  origin and record it in `docs/compliance/web.md`.
- Because `connect-src` depends on per-environment origins, generate the host
  config's CSP from the env module at build time with a small script, or keep
  one config per environment; record which. Do not widen it to `https:`.
- Add a `report-to` or `report-uri` directive only if the user has somewhere
  to send reports; otherwise leave it out rather than pointing it at nothing.
- Test it: an end-to-end test cannot see host headers through `vite preview`,
  so add a unit test that reads the host config file and asserts each
  required header is present and that `script-src` contains no `unsafe-`
  keyword. Configure `vite preview`'s `preview.headers` with the same CSP so
  the end-to-end suite runs under it and a CSP violation shows up as a console
  error the tests fail on. The post-deploy job in CI then checks the real
  response headers with `curl -I`.

## Static analysis and supply chain

**Default: four tools, all free, all runnable locally and in CI.**

| Tool | Job | Where it runs |
| --- | --- | --- |
| Semgrep (community edition) | Static analysis of TypeScript and React, using its default, security, React, and secrets rule sets | Repository script and CI, failing on high severity |
| OSV-Scanner | Known vulnerabilities across the lockfile, from the OSV database | Repository script and CI, failing on high and critical |
| Gitleaks | Secret detection | Pre-commit hook, CI over the repository, and CI over `dist/` after the build |
| A licence checker | An allow list of permitted licences | CI, with the allow list committed |

- Semgrep's community edition analyses within one file at a time; say so in
  the README rather than implying full dataflow coverage. Run it in diff-aware
  mode on pull requests so a fresh project is not permanently red.
- Confirm OSV-Scanner's current invocation with its own `--help`. If the
  organisation mandates a different scanner, use that; the point is a second
  source beyond `npm audit`.
- Enable automated dependency update pull requests, grouped, not
  auto-merged.
- **An SBOM** generated in CI from the lockfile with a maintained generator
  (for example the CycloneDX npm tool, or `npm sbom` if the npm version
  supports it) and uploaded as an artefact.
- **Dependency review on pull requests** where the platform provides it at
  no cost (on GitHub, free for public repositories, paid for private ones;
  confirm before promising it).

## Bundle size budget

**Default: a size check on the built output that fails CI when the initial
JavaScript exceeds a recorded budget.**

Use a maintained tool (for example `size-limit` with its file preset) or a
short script over `dist/assets/`. Set the budget from what the scaffold
actually produces plus headroom, record the number and the reasoning in the
tooling ADR, and treat raising it as a deliberate, reviewed change. Route-level
lazy loading (see `decisions.md`) is the main way to stay inside it. A full
Lighthouse performance budget is on the explicit-request list.

## Browser support

Use Vite's default `build.target` unless the brief names an older browser
floor. If it does, set `build.target` (and a `browserslist` entry, if any tool
reads one) to match, and record it in the tooling ADR. Do not add a legacy
polyfill plugin unless a named requirement demands it, because it roughly
doubles the build output.

## Deliberately not in the baseline

Do not add these without being asked, and if the user asks, say what each one
costs: SonarQube or SonarCloud, GitHub Advanced Security with CodeQL, Snyk,
Trivy or Grype, DAST scanning, Lighthouse CI, visual regression testing,
Storybook, device clouds, error tracking and real-user monitoring SDKs,
feature flag services, internationalisation frameworks, a commercial
accessibility engine, and signed build provenance.

## Wiring it up

For each tool:

1. Add the script to the manifest with a predictable name: `dev`, `build`,
   `preview`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`,
   `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:smoke`,
   `size`, and one script per analysis tool (`scan:sast`, `scan:deps`,
   `scan:secrets`, `scan:secrets:dist`, `scan:licences`, `sbom`).
2. Add a CI job that runs exactly that script, with no duplicated command
   strings between the pipeline and the manifest.
3. Document it in `README.md` and `AGENTS.md`.
4. Run it locally and record the result.
