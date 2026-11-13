---
name: scaffold-react-spa
description: Scaffold a new React single page application in TypeScript with Vite, from any input, be that a single line, a detailed brief, or a repository of design and architecture documentation. Asks up front which hosting target, router, server-state library, and CI platform to use, enforces those answers across every config file, script, test, and CI job, then wires up linting, formatting, Vitest unit tests, Playwright end-to-end tests, automated and manual accessibility testing, security headers, and static and dependency analysis. Use when the user asks to start, scaffold, bootstrap, initialise, or set up a React web app, React SPA, Vite React project, front end, admin console, dashboard, or client-side web app, or to fill in a missing quality, testing, or CI baseline on one, even if they do not say "SPA".
---

# Scaffold a React single page application

## When to use

Use this skill whenever the user wants a new client-rendered React web
application, a new SPA inside an existing repository, or an existing Vite React
project that has no quality or CI baseline. Triggers include "start a React
app", "scaffold a Vite React project", "bootstrap a front end for this API",
"set up an admin dashboard in React", "here is our design doc, set up the web
client", and "add tests and CI to this React SPA".

Do not use it for React Native or Expo (use `scaffold-react-native-app`), for a
server-rendered or statically generated React framework project (Next.js,
Remix, Astro, or React Router framework mode with server rendering), for a
React component library published to a registry, or for adding a single
feature to an app that already has its tooling in place. If the user asks for a
"React app" and the brief needs server rendering for SEO or first paint, say so
and ask whether an SPA is really what they want before going further.

## Operating principles

These five rules govern every decision below. When they conflict, they win in
this order.

1. **Never write configuration from memory.** The front-end toolchain moves
   faster than any model can track. Do not paste remembered `package.json`
   fragments, `vite.config.ts` bodies, linter configs, or workflow YAML from
   training data. Prefer generators (`create-vite`, the router's own CLI or
   Vite plugin, `playwright init`) over hand written configuration, read the
   current official documentation for each choice, and confirm every flag with
   `--help` before you rely on it. This rule applies to this skill's own
   reference files as well as to your training data: a specific flag, package
   name, or "this is the current way" claim in `references/` was correct when
   that file was last reviewed, not guaranteed correct now. Each reference
   file states its last review date; treat anything in it specific enough to
   go stale as a hypothesis to reconfirm, not as settled fact.
2. **Ask before you scaffold.** The hosting, router, server-state, and CI
   decisions are mandatory questions (step 2). Everything else is derived from
   the input wherever possible, because a long intake is worse than a small
   mistake.
3. **Smallest sufficient tooling.** Choose the mainstream, well maintained,
   free option that gets the job done and survives a security or standards
   audit. Do not add enterprise tooling unless the user explicitly asks for it
   (see "Only on explicit request" below).
4. **Nothing ships unverified.** Every script you add must run and exit zero
   before you hand the project over. A pipeline that has never executed is not
   a pipeline, it is a guess.
5. **Record the decisions.** The four decisions, the tooling baseline, and the
   Node version belong in architecture decision records and in `AGENTS.md`, so
   that a later reader (or a later agent) knows they are deliberate.

## Step 1: Classify the input

The input takes one of three shapes. Identify which one you have before doing
anything else, because each shape changes how much you need to read.

- **A single line.** Usually an app name and one idea. Derive a minimal brief,
  confirm it back, and scaffold the smallest thing that supports it.
- **A paragraph or a brief.** Already contains most of what you need. Extract
  the requirements, do not re-ask them.
- **A repository or a pile of design and architecture documentation.** You must
  read before you write. See `references/intake.md` for the discovery order,
  what to extract, and how to summarise it back for confirmation.

If the target directory is inside an existing monorepo or workspace (a root
`package.json` with a `workspaces` field, a `pnpm-workspace.yaml`, a
`turbo.json`, an `nx.json`, or a lockfile above the directory you were pointed
at), say so before going further. This skill is built and verified for a
single, standalone repository; workspace boundaries, shared lint and
TypeScript configs, and CI scoped to a sub-path are not covered by it. Ask the
user how they want those boundaries handled, and do not assume the single-repo
defaults transfer unchanged.

In every case, produce a short brief (roughly five to ten bullets) covering the
app name and slug, the audience and whether it is public or behind sign-in,
the main user flows, the route tree, the data sources and authentication
approach, the design system if one exists, the browser support expectation,
and any explicit constraints. Show the brief to the user and get a yes before
scaffolding, unless they have already told you to go ahead without checking.
Ask, with the brief, for permission to run `git init` and make local commits
(see step 4), so that the user is interrupted twice at most: once for the
brief and git permission, and once for the four decisions.

### Retrofit: an existing React SPA

If the target already contains a working Vite React app (the user asked to add
tests, CI, or a quality baseline to it), do not run the generator and do not
replace its pages. Instead:

1. Read it the way `references/intake.md` describes for a repository, and
   infer the four decisions from what is already there (the installed router,
   any server-state library, any host config, any CI file). Present them as
   the recommended answers in step 2, flagging any that are missing or mixed.
2. Before changing anything, measure: run the type check with the strict
   settings from `tooling.md`, the linter with the baseline rules, and axe on
   the main routes, in a scratch copy or with the changes uncommitted, and
   count the errors per gate.
3. Report the counts and ask the user to choose, per gate, between fixing
   everything now (state roughly how much work that is) and a recorded
   baseline: a committed file listing the existing violations that CI allows
   but forbids from growing, with new and changed files held to the full
   rules. Do not start a large refactor nobody asked for, and do not silently
   add suppressions; a recorded, shrinking baseline is the only exception to
   the hard rules below, and it must be visible in the tooling ADR and the
   README.
4. Then apply steps 5 to 8 as for a new project, adding to the app rather
   than replacing it.

## Step 2: Ask the four mandatory questions

Ask all four in a single call to the question tool (which takes at most four
questions per call, so do not add others to it). Default every option you offer and label the default as recommended. If
the input already answers one of them unambiguously (an ADR that names the
host, a brief that says "we use TanStack Query"), state the answer you took
from it and where it came from in the question text, offer it as the
recommended option, and still ask, because a misread document is cheaper to
correct now than after scaffolding.

1. **Hosting target.** Required. Where the built static files will be served
   from decides the history fallback rewrite, where security headers and the
   Content Security Policy live, the base path, the cache rules, the deploy
   job, and the release credentials. `references/decisions.md` lists the
   supported targets and what each one changes.
2. **Router.** Required. React Router (data router, used as a library) is the
   recommended default; TanStack Router is the alternative when the brief
   values fully typed routes and search parameters. `references/decisions.md`
   explains each.
3. **Server-state library.** Required. TanStack Query is the recommended
   default for any app that talks to an API; "none, a small typed fetch
   client" is the right answer for an app with no backend or one or two
   calls. `references/decisions.md` explains each.
4. **CI platform.** Default to GitHub Actions. If the input names GitLab,
   Azure Pipelines, Bitbucket Pipelines, CircleCI, or Jenkins, offer that as
   the first option. `references/ci.md` covers each of these.

Some combinations carry a cost or a constraint the user should see before
answering, so put it in the option's description rather than discovering it
after handover:

- GitHub Pages with a CI platform other than GitHub Actions has no
  short-lived deploy credential (see `decisions.md`); say so on the Pages
  option.
- A private repository on a free plan may not allow GitHub Pages, enforced
  branch protection, or merge checks, and a free CI tier may have too few
  minutes for a three-browser nightly suite (Bitbucket's free tier, for
  example). If the brief suggests a small organisation, a charity, or a free
  plan, check the provider's current plan pages and state the limits in the
  question. `ci.md` describes the reduced job graph for low-minute plans.

Never infer the hosting target, router, or server-state choice silently, and
never scaffold before all four are answered. Ask a further question only if
the input genuinely does not determine it: the app name and slug, or the
package manager when neither the input nor an existing repository implies
one. Default to npm.

## Step 3: Establish the current facts

Before you write a single line, establish what actually exists today. Run
these checks rather than recalling them:

- `node --version`, and confirm the Node release you will target is a current
  active or maintenance LTS.
- `npm view vite version`, `npm view react version`, `npm view create-vite
  version`, and the router and server-state packages you were told to use.
- Read the official documentation for each choice (`vite.dev`,
  `react.dev`, `reactrouter.com` or `tanstack.com/router`, `tanstack.com/query`,
  and the hosting provider's SPA and headers documentation), including the
  most recent changelog, and note the breaking changes that affect a fresh
  project.
- Run `npm create vite@latest -- --help` and confirm the template name and
  flags you intend to use.
- For every tool you plan to install, run `npm view <package> version` and
  inspect `peerDependencies` so you do not combine majors that conflict.
- Cross-check the Node version against Vite's own supported range (its
  `engines` field), not only against what is installed locally.

Then let the generator pick the versions. Do not pin Vite, React, or the
router yourself, because a hand chosen version is a stale version within a
month. Record what the generator and the installer produced.

If `npm view` or a generator cannot reach the registry, do not guess version
numbers to fill the gap. Say so, proceed on whatever actually resolves, and
state in your final report that version discovery depended on an offline
fallback and should be re-checked once the project has network access.

If a `peerDependencies` check turns up a conflict between two tools, do not
resolve it silently with `--legacy-peer-deps` or `--force`. Prefer the newer
major that still satisfies the other constraint; if no combination satisfies
every constraint, stop and ask the user which tool to drop or downgrade, and
record the answer in the tooling ADR.

## Step 4: Scaffold the project

Use the decisions recorded in step 2. `references/decisions.md` holds the
scaffolding steps for each router and server-state choice, the per-host
configuration, and the enforcement sweep you must run at the end of this step.
The sweep is not optional: it is how the four decisions are enforced
consistently across the repository rather than mentioned in a README.

Scaffold real routes, not a demo. Replace the generator's counter page with a
layout route, one route per main flow in the brief, a not-found route, and a
route-level error boundary. If the brief has four flows, the scaffold needs
four reachable routes, not one placeholder and a TODO.

Four rules apply regardless of the decisions:

- **TypeScript is enforced throughout, not merely present.** Set `strict: true`
  and `allowJs: false` in every `tsconfig` the generator produced (Vite
  generates more than one: one for the app and one for the Node-side config
  files), and make the type check a blocking gate in CI. The type check must
  use `tsc -b` (or `tsc --noEmit -p` against each config) so that every
  project reference is checked; running plain `tsc --noEmit` against a
  solution-style root `tsconfig.json` with an empty `files` array checks
  nothing and passes. Confirm that the TypeScript major the template
  installed supports build mode before relying on `tsc -b`. Run the linter's
  type-aware rules so the linter sees the same types.
- **Put the project under version control, with permission.** Many users
  forbid git actions without explicit permission (check `CLAUDE.md` and
  similar instructions), and their instructions outrank this skill. So ask,
  with the brief in step 1, whether you may run `git init` and make local
  commits. If yes: make an initial commit of exactly what the generator
  produced, and commit again after each verified step in Step 5 rather than
  once at the end. If no, or if you cannot ask: make no git changes at all, and
  instead list in the final report the commit sequence you would have made, so
  the user can make it themselves. Never push without a separate instruction.
  If the generator fails partway through, inspect what exists before
  continuing; remove debris from the failed run and re-run from a clean
  directory.
- **Everything in the bundle is public.** Vite inlines every `VITE_`-prefixed
  variable into the JavaScript it ships to every visitor. Never put a secret,
  private API key, signing key, or client secret in one, whatever the
  variable is called. Read every `VITE_` variable in a single typed module
  (for example `src/env.ts`) that validates the variables at start-up (literal
  `import.meta.env.DEV`, `PROD`, and `MODE` checks stay where they are used,
  because Vite only strips development code behind a literal condition),
  document the names in `.env.example`, gitignore the real `.env*.local`
  files, and pass deploy-time credentials to CI as repository secrets.
  Authentication uses a public client flow (authorisation code with PKCE) or a
  backend-for-frontend; never an embedded client secret.
- **Secrets are caught before they enter history.** Wire a secret scanner into
  the pre-commit hook (see `tooling.md`), not only into CI, and also scan the
  built `dist/` directory in CI, since that is where an accidentally exposed
  `VITE_` value actually ships.

## Step 5: Apply the tooling baseline

`references/tooling.md` is the catalogue. It lists, for each concern, the
pragmatic default, why it was chosen, and what to skip. The baseline covers:

- Node, package manager, and lockfile discipline.
- TypeScript configuration and the type checking gate.
- Oxlint, as the template generates it (type-aware, React hooks, `jsx-a11y`,
  and a few in-repo checks).
- Prettier, import sorting, and the format check.
- Git hooks.
- Unit and component testing with Vitest and React Testing Library, never
  optional, with a coverage floor enforced in CI, and network calls mocked at
  the network layer with Mock Service Worker rather than by stubbing modules.
- End-to-end testing with Playwright against the production build, required
  for the main user flows and explicitly not for every page.
- Accessibility testing at four levels: static lint rules, component-level axe
  checks in the unit suite, page-level axe checks in Playwright on every main
  route, and a documented manual procedure (keyboard only, screen reader,
  zoom and reflow, reduced motion). If the brief states a target such as WCAG
  2.2 AA, say explicitly that this tooling narrows risk and does not itself
  certify conformance.
- Static analysis and supply chain: Semgrep, OSV-Scanner, Gitleaks (on the
  repository and on `dist/`), a licence check, an SBOM, and a bundle size
  budget.
- Security headers and a Content Security Policy, configured for the chosen
  host and tested.

Do not install a tool without adding its script to `package.json` and its job
to CI in the same change. An uninstalled tool is noise, and an unrun tool is
worse.

## Step 6: Wire up CI/CD

`references/ci.md` holds the pipeline shapes for GitHub Actions, GitLab CI,
Azure Pipelines, Bitbucket Pipelines, CircleCI, and Jenkins, including the job graph, the permissions
settings, browser caching for Playwright, and the deploy job per host.

The job graph is the same everywhere. Fast, blocking jobs first:

1. Lint, format check, and type check.
2. Unit and component tests with the coverage floor enforced.
3. Static analysis, dependency scan, secret scan, and licence check.
4. Production build, `dist/` secret scan, and bundle size budget.
5. End-to-end and page-level accessibility tests in Chromium against the
   built output, for the flows tagged as smoke.
6. The full end-to-end suite across Chromium, Firefox, and WebKit, plus SBOM
   generation, on a nightly or release schedule.
7. Deploy to the chosen host, on the default branch or on tags, followed by a
   post-deploy check of the live responses and headers (adjusted for hosts
   that cannot set headers or rewrites; see `ci.md`).

Always scaffold the deploy job, even though it cannot succeed until the user
has created the hosting resources and credentials. Mark it clearly as blocked
in a comment at the top of the job, and produce an exact checklist in the
README of the secrets and variables it reads (name, where it comes from, and
which service issues it). Prefer short-lived OIDC federation (GitHub to AWS,
Azure, or Google Cloud) over long-lived access keys wherever the host supports
it, and say which one you used.

Pin every third-party action used in a job that reads a secret (the deploy
job, and any SAST job that uploads results) to a full commit SHA, not a
release tag. Jobs that never see a secret can keep the simpler tag pin.
Install and run `actionlint` (or the current equivalent for the platform you
chose) rather than treating it as optional.

Documenting branch protection is not the same as applying it. If the project
is already pushed to a real remote and the CLI is authenticated, offer to
apply the required status checks, show exactly what you are about to change,
and only apply it after the user confirms. Never apply a repository setting
silently. Say in your final report which of the two actually happened.

## Step 7: Verify before handing over

`references/verify.md` is the checklist. Run every item in the scaffolded
project and fix anything that fails. Do not report success on the strength of
the files you wrote. In summary:

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and
  `npm run test:coverage` pass, and each gate is proved to bite by a temporary
  deliberate violation.
- `npm run build` produces `dist/`, the bundle size budget passes, a secret
  scan of `dist/` is clean, and `dist/` contains no mock or devtools code.
- Install the Playwright browsers and run the end-to-end suite against
  `vite preview` of the production build. Unlike a mobile emulator, a
  headless browser runs reliably in most environments, so a real run is
  expected here. If the browsers genuinely cannot be installed (no network,
  missing system libraries), say so plainly rather than presenting a syntax
  check as equivalent.
- A deep link to a nested route served by the preview server returns the app,
  not a 404, and the host's fallback configuration is shown to do the same.
- The dependency audit, secret scan, and static analysis pass locally with the
  same commands CI uses.
- The CI configuration parses, and `actionlint` (or the equivalent) is clean.

## Step 8: Document and report

Create or update, in the project root:

- `README.md` with the scripts table, prerequisites, local setup, the
  environment variables and the warning that `VITE_` values are public, the
  branch protection requirement, the deploy secrets checklist, and a short
  architecture note.
- `AGENTS.md` recording the conventions, the four decisions, the tooling
  baseline, the rule that environment access goes through the typed env
  module, and the commands that must pass before a commit.
- `SECURITY.md` with how to report a vulnerability.
- `docs/accessibility.md` with the manual accessibility procedure, its owner,
  and its release gate (see `tooling.md`).
- `docs/adr/` with at least five records: hosting target, router,
  server-state library, the CI platform, and the tooling and testing baseline,
  each stating the context, the decision, and the consequences. The hosting
  record includes the enforcement sweep result.
- `docs/compliance/web.md` (see `references/web-compliance.md`): cookies and
  local storage, consent, third-party scripts, the security headers and CSP in
  force, and the accessibility statement obligation if one applies.

Then report back in prose: what you scaffolded, which versions the generator
and installer chose, the four decisions and why, every check you ran and its
result, anything you could not run and why, and anything you deliberately left
out.

## Audit-facing minimum

A reviewer should be able to point at each of these without hunting:

- A committed lockfile, `npm ci` in CI, and a pinned Node version.
- TypeScript strict mode with `allowJs: false` in every project config,
  enforced by a blocking job that genuinely checks every config.
- Lint and format checks that fail the build, and a pre-commit hook running the
  fast subset plus a secret scan.
- Unit and component tests with a coverage floor, and end-to-end coverage of
  the main flows against the production build.
- Accessibility lint rules, component-level and page-level axe checks, and a
  written manual procedure with an owner.
- SAST, dependency scanning, secret scanning of the repository and of `dist/`,
  a licence allow list, and a generated SBOM.
- A Content Security Policy and security headers configured at the host and
  verified, with no `unsafe-inline` for scripts, or, on a host without header
  control, a build-time `<meta>` CSP and the missing headers recorded as an
  accepted risk.
- No secret in any `VITE_` variable, committed file, or workflow definition,
  and short-lived deploy credentials where the host allows them.
- Secret-bearing CI jobs pinned to a commit SHA.
- The deploy job present and documented, even while blocked on credentials.
- Branch protection either applied (with confirmation on record) or clearly
  flagged as pending.
- Decision records for the choices that would otherwise look arbitrary.

## Only on explicit request

Offer these if and only if the user asks for enterprise grade, compliance
certification, or a named vendor. Mention them as available; do not add them
by default: SonarQube or SonarCloud, GitHub Advanced Security with CodeQL,
Snyk, Trivy or Grype, OWASP ZAP or another DAST scanner against a deployed
environment, Lighthouse CI performance budgets, visual regression testing
(Chromatic, Percy, or Playwright screenshot baselines), Storybook, cross-browser
device clouds (BrowserStack, Sauce Labs), real-user monitoring and error
tracking SDKs, feature flag services, internationalisation frameworks, a
commercial accessibility engine, and SLSA provenance with signed SBOMs.

## Hard rules

- Do not scaffold before the four mandatory questions are answered.
- Do not mix decisions. A project that chose React Router must not depend on
  TanStack Router, and the reverse; a project that chose "no server-state
  library" must not grow a hand rolled cache that reimplements one; a project
  must contain the fallback and headers configuration for exactly one host.
- Do not put a secret in a `VITE_` variable, in `index.html`, or anywhere else
  that ends up in `dist/`.
- Do not add `any`, `@ts-ignore`, `@ts-expect-error` without a reason, or a
  widened `tsconfig` to silence an error. Fix the type.
- Do not leave out the `jsx-a11y` lint rules or any of the axe layers, for a
  version conflict or any other reason. Resolve the conflict instead (see
  `tooling.md`), and record how.
- Do not let mock workers, mock sign-in, fixtures, or devtools reach `dist/`.
- Do not disable a test, an axe rule, or a lint rule to make a pipeline green.
  If an axe rule must be excluded, scope the exclusion to the element and
  record why next to it.
- Do not add `unsafe-inline` or `unsafe-eval` to `script-src` in the CSP.
- Do not run end-to-end tests against the Vite dev server in CI. Run them
  against the production build.
- Do not leave a tool installed but unwired, or wired but not documented.
- Do not tag-pin a third-party action in a job that reads a secret.
- Do not apply a branch protection rule, repository setting, cloud resource,
  or DNS change through an authenticated CLI without first showing the user
  exactly what will change and getting their confirmation.
