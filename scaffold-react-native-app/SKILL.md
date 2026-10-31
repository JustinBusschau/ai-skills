---
name: scaffold-react-native-app
description: Scaffold a new React Native app in TypeScript from any input, be that a single line, a detailed brief, or a repository of design and architecture documentation. Asks whether to use Expo, enforces that answer across every script, test, and CI job, then wires up linting, formatting, accessibility testing, unit tests, Maestro end-to-end tests, and static and dependency analysis. Use when the user asks to start, scaffold, bootstrap, initialise, or set up a React Native or Expo project, or to fill in a missing quality, testing, or CI baseline on one.
---

# Scaffold a React Native app

## When to use

Use this skill whenever the user wants a new React Native project, or a new app
inside an existing repository, or an existing React Native project that has no
quality or CI baseline. Triggers include "start a React Native app", "scaffold",
"bootstrap", "set up a new RN project", "create an Expo app", "I have an idea for
an app and want to start building it", "here is our design doc, set up the repo",
and "add tests and CI to this RN project".

Do not use it for a web React project, for a Flutter or native iOS or Android
project, or for adding a single feature to an app that already has its tooling
in place.

## Operating principles

These five rules govern every decision below. When they conflict, they win in
this order.

1. **Never write configuration from memory.** The React Native landscape moves
   faster than any model can track. Do not paste remembered `package.json`
   fragments, `babel.config.js` bodies, or workflow YAML from training data.
   Prefer generators (`create-expo-app`, `@react-native-community/cli init`,
   `expo prebuild`) over hand written configuration, read the current official
   documentation for the path you chose, and confirm every flag with
   `--help` before you rely on it. A config option you remember may have been
   renamed, replaced, or removed. Verify, then write. This rule applies to this
   skill's own reference files as well as to your training data: a specific
   flag, package name, or "this is the only supported mode" claim in
   `references/` was correct when that file was last reviewed, not guaranteed
   correct now. Each reference file states its last review date; treat
   anything in it specific enough to go stale as a hypothesis to reconfirm
   against current docs, not as settled fact.
2. **Ask before you scaffold.** The Expo decision and the CI platform decision
   are mandatory questions (step 2). Everything else is derived from the input
   wherever possible, because a long intake is worse than a small mistake.
3. **Smallest sufficient tooling.** Choose the mainstream, well maintained,
   free option that gets the job done and survives a security or standards
   audit. Do not add enterprise tooling unless the user explicitly asks for it
   (see "Only on explicit request" below).
4. **Nothing ships unverified.** Every script you add must run and exit zero
   before you hand the project over. A pipeline that has never executed is not
   a pipeline, it is a guess.
5. **Record the decisions.** The Expo decision, the tooling baseline, and the
   Node version belong in an architecture decision record and in `AGENTS.md`, so
   that a later reader (or a later agent) knows they are deliberate.

## Step 1: Classify the input

The input takes one of three shapes. Identify which one you have before doing
anything else, because each shape changes how much you need to read.

- **A single line.** Usually an app name and one idea. Derive a minimal brief,
  confirm it back, and scaffold the smallest thing that supports it.
- **A paragraph or a brief.** Already contains most of what you need. Extract
  the requirements, do not re-ask them.
- **A repository or a pile of design and architecture documentation.** You must
  read before you write. See `references/intake.md` for the discovery order, what
  to extract, and how to summarise it back for confirmation.

If the target directory is already part of an existing monorepo or workspace
(a root `package.json` with a `workspaces` field, a `turbo.json`, an `nx.json`,
or a lockfile above the directory you were pointed at), say so before going any
further. This skill is built and verified for a single, standalone repository;
workspace boundaries, shared lint and TypeScript configs, and CI scoped to a
sub-path are not covered by it. Proceed carefully, ask the user how they want
those boundaries handled, and do not assume the single-repo defaults elsewhere
in this skill transfer unchanged.

In every case, produce a short brief (roughly five to ten bullets) covering the
app name and slug, target platforms, the main user flows, the navigation shape,
the state and data approach, the design system if one exists, and any explicit
constraints. Show the brief to the user and get a yes before scaffolding,
unless they have already told you to go ahead without checking.

## Step 2: Ask the two mandatory questions

Ask both in a single call to the question tool so the user is interrupted once,
not twice. Default every option you offer and label the default as recommended.

1. **Expo or not?** Required. Never infer this from the input, and never
   scaffold before it is answered. `references/decision-expo.md` explains what
   each choice means and what follow-up question it triggers.
2. **Which CI platform?** Default to GitHub Actions. If the input names GitLab,
   Jenkins, CircleCI, Bitrise, or Codemagic, offer that as the first option.

Ask a third question only if the input genuinely does not determine it: the app
name and slug (the directory and bundle identifier follow from it), or the
package manager if the input or the existing repository already implies one.
Default to npm.

## Step 3: Establish the current facts

Before you write a single line, establish what actually exists today. Run these
checks rather than recalling them:

- `node --version`, and confirm the Node release you will target is a current
  active or maintenance LTS.
- `npm view react-native version`, `npm view expo version`, and
  `npm view create-expo-app version` to see the current stable line.
- Read the official documentation for the path you chose (`reactnative.dev` for
  bare React Native, `docs.expo.dev` for Expo), including the most recent
  release or SDK changelog, and note the breaking changes that affect a fresh
  project.
- Run `npx @react-native-community/cli@latest init --help` or
  `npx create-expo-app@latest --help` and confirm the flags you intend to use.
- For every tool you plan to install, run `npm view <package> version` and
  inspect `peerDependencies` so you do not combine majors that conflict.
- Cross-check the Node version against the framework's own supported range
  (the generated project's `engines` field, or the current compatibility table
  in the official docs), not only against what is installed locally.
  `node --version` only tells you what you have, not what the framework you
  just resolved actually supports.

Then let the generator pick the versions. Do not pin a React Native, React, or
Expo version yourself, because a hand chosen version is a stale version within
a month. Record what the generator produced.

If `npm view` or a generator command cannot reach the registry, do not guess
version numbers to fill the gap. Say so, let the generator fall back to its own
offline or cached resolution if it has one, proceed on whatever it actually
resolves, and state in your final report that version discovery depended on an
offline fallback and should be re-checked once the project has network access.

If a `peerDependencies` check turns up a conflict between two tools you are
about to install, do not resolve it silently. In order of preference: prefer
whichever side the framework installer manages (both Expo's installer and the
community CLI resolve native and peer dependencies deliberately, which beats a
hand chosen version); if both sides are a free choice, prefer the newer major
that still satisfies the other constraint; if no combination satisfies every
constraint, stop and ask the user which tool to drop or downgrade, and record
the answer in the architecture decision record. Do not pin a version purely to
make the conflict go away without recording why.

## Step 4: Scaffold the project

Use the decision recorded in step 2. Both paths are documented in
`references/decision-expo.md`, which also contains the enforcement sweep you
must run at the end of this step. The sweep is not optional: it is the mechanism
by which the Expo decision is enforced consistently across the repository.

Two rules apply to both paths:

- **TypeScript is enforced throughout, not merely present.** Set `strict: true`
  and `allowJs: false` in `tsconfig.json`, and make `tsc --noEmit` a blocking
  gate in CI. `allowJs: false` is what stops JavaScript creeping back in.
  Configure ESLint with type aware rules so the linter sees the same types.
- **Put the project under version control before you do anything else.** Run
  `git init` if the directory is not already a repository, make an initial
  commit of exactly what the generator produced before you add any tooling,
  and commit again after each verified step in Step 5 (lint, then tests, then
  analysis, and so on) rather than once at the end. A scaffold that fails
  halfway through is cheap to recover from a run of small commits and
  expensive to recover from one uncommitted pile of changes. These are local
  commits; do not push anywhere without the user's separate instruction. If
  the generator itself fails or is interrupted partway through (a network
  drop mid-install, a crashed process), do not commit the half-written tree as
  if it were a clean baseline. Inspect what exists first; if it is clearly
  unusable debris from the failed run rather than anything the user authored,
  remove it and re-run the generator from a clean directory before making the
  first commit.
- **Never commit a secret, and never put one in a committed file.** Use
  `.env.example` to document the variable names, gitignore the real `.env`
  files, and pass real values to CI as repository secrets. Wire a secret
  scanner into the pre-commit hook (see `tooling.md`), not only into CI: by
  the time CI catches a committed secret it is already in git history, which
  for a public or soon-to-be-public repository means it may already have been
  harvested. CI-only scanning is a backstop, not the primary control.

## Step 5: Apply the tooling baseline

`references/tooling.md` is the catalogue. It lists, for each concern, the
pragmatic default, why it was chosen, what the audit-relevant options are, and
what to skip. The baseline covers:

- Node, package manager, and lockfile discipline.
- TypeScript configuration and the type checking gate.
- ESLint (flat config, type aware, with in-repo React Native rules).
- Prettier, import sorting, and the format check.
- Git hooks.
- Unit testing, which is never optional, with coverage thresholds enforced in
  CI.
- End-to-end testing with Maestro, required for the main user flows and
  explicitly not required for every screen.
- Accessibility testing at three levels: static lint rules, component level
  assertions in the unit suite, and a documented manual screen reader
  procedure, since neither Maestro nor Jest can drive VoiceOver or TalkBack.
  If the brief states a compliance target such as WCAG 2.2 AA, this tooling
  narrows the risk but does not itself certify conformance; say so explicitly
  in the documentation rather than letting the presence of lint rules and a
  test helper imply a conformance claim nobody has actually checked.
- Static and dynamic analysis: Semgrep, dependency scanning, secret scanning,
  licence checking, an SBOM, and a production bundle smoke test. Note which of
  these belong in a repository script and which belong in a CI job.

Do not install a tool from this catalogue without adding its script to
`package.json` and its job to CI in the same change. An uninstalled tool is
noise, and an unrun tool is worse.

## Step 6: Wire up CI/CD

`references/ci.md` holds the pipeline shapes for GitHub Actions, GitLab CI, and
Jenkins, including the job graph, the concurrency and permissions settings, the
emulator handling for end-to-end tests, and the cache and lockfile rules.

The job graph is the same everywhere. Keep the fast, blocking jobs first and
gate the expensive ones behind them:

1. Lint, format check, and type check. No build, no emulator, a few seconds.
2. Unit tests with coverage thresholds enforced.
3. Static analysis, dependency scanning, secret scanning, and licence check.
4. Production bundle smoke test, which proves the app actually bundles.
5. End-to-end tests on an emulator, for the flows tagged as critical.
6. The full end-to-end suite and SBOM generation on a nightly or release
   schedule rather than on every pull request.

In every pipeline: use the pinned Node version from `.nvmrc`, install with
`npm ci` against the committed lockfile, grant the least privilege permissions
the job needs, cache the dependency directory rather than rebuilding it, and
cancel superseded runs. Document the required branch protection in the README,
because a passing pipeline with no protection rules protects nothing.

Always scaffold the release and store-submission job (job 8 in `ci.md`), even
though it cannot succeed until the user has created real signing and store
credentials. Mark it clearly as blocked in a comment at the top of the job, and
produce an exact checklist in the README of the secrets it reads (name, where
it comes from, and which store or service issues it), so the gap is visible on
day one rather than discovered the first time someone tries to ship a build.
This is deliberate: a pipeline with a structurally complete but honestly
blocked release job is more useful than one that pretends the concern does not
exist yet.

Pin every third-party action used in a job that reads a secret (the release
job, and any SAST job that uploads results) to a full commit SHA, not a
release tag. Jobs that never see a secret (lint, type check, unit tests, the
bundle smoke test) can keep the simpler tag pin. `ci.md` has the detail and the
reasoning.

Install and run `actionlint` (or the current equivalent for the platform you
chose) rather than treating it as optional. A workflow file can be valid YAML
and still be a broken workflow, and this is the cheapest check that catches
that class of bug before the first real run.

Default the automatic emulator jobs (the pull request smoke run and the
nightly full suite) to Android only. A macOS runner for an iOS simulator costs
substantially more per minute on GitHub Actions and most other platforms, so
that is a real, recurring cost decision rather than a free extra; make iOS
end-to-end coverage an explicit, documented opt-in and say this plainly in the
README so the user turns it on with the cost in view.

Documenting branch protection is not the same as applying it. If the project
is already pushed to a real GitHub (or GitLab) repository and the CLI is
authenticated, offer to apply the required status checks for the user, show
exactly what you are about to change, and only apply it after they confirm.
Never apply a repository setting change silently. If there is no authenticated
access, or the user declines, fall back to documenting the requirement
prominently, and say in your final report which of the two actually happened.

## Step 7: Verify before handing over

`references/verify.md` is the checklist. Run every one of these in the
scaffolded project and fix anything that fails. Do not report success on the
strength of the files you wrote.

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
  and `npm run test:coverage` all pass.
- `npm run build` (or the platform equivalent) produces a bundle.
- `npx expo-doctor`, for Expo projects, is clean.
- The dependency audit, secret scan, and static analysis jobs pass locally with
  the same commands CI uses, so a red pipeline is not the first time anyone
  sees the finding.
- The end-to-end harness is wired up: install the real Maestro CLI, run its
  syntax check against every flow file, and cross-reference every selector
  against a `testID` that actually exists in the source. Do not attempt to
  boot an emulator during scaffolding; most environments this skill runs in
  cannot do that reliably, and a hung or failed boot attempt wastes time
  without changing the outcome. Say plainly in your report that execution
  against a real emulator was not attempted and remains the user's first
  manual check. If the Maestro CLI cannot be installed at all, fall back to a
  manual read of each flow file and say so plainly, rather than treating the
  syntax check as done.
- The CI configuration is syntactically valid. For GitHub Actions, validate the
  YAML with a parser and install and run `actionlint` rather than skipping it
  for convenience; a YAML parser alone will not catch a bad expression context
  or a `needs` reference to a job that does not exist. If `actionlint`
  genuinely cannot be installed, say so plainly rather than presenting the
  plain YAML parse as equivalent.

## Step 8: Document and report

Create or update, in the project root:

- `README.md` with the scripts table, the prerequisites, the local setup steps,
  the branch protection requirement, and a short architecture note.
- `AGENTS.md` recording the conventions, the tooling baseline, the rules for
  adding a dependency (install through the tool the framework mandates, never
  the bare package manager), and the list of commands that must pass before a
  commit.
- `SECURITY.md` with how to report a vulnerability. A short file satisfies the
  convention and costs nothing.
- `docs/adr/` with at least two records: one for the Expo decision and one for
  the tooling and testing baseline, each stating the context, the decision, and
  the consequences.
- `docs/compliance/app-store.md` (see `references/app-store-compliance.md` for
  what belongs in it): the iOS privacy manifest and usage-description strings,
  and the Android permission and Data Safety declarations, that the app will
  need before store submission, stated as a checklist rather than implemented
  blind, since the actual values depend on which device capabilities the app
  ends up using.

Then report back in prose: what you scaffolded, which versions the generator
chose, the two decisions and why, the full list of checks you ran and their
results, anything you could not run and why, and anything you deliberately left
out.

## Audit-facing minimum

A reviewer should be able to point at each of these without hunting:

- A committed lockfile, `npm ci` in CI, and a pinned Node version.
- TypeScript strict mode with `allowJs: false`, enforced by a blocking job.
- Lint and format checks that fail the build, and a pre-commit hook that runs
  the fast subset locally.
- Unit tests with a coverage floor, and end-to-end coverage of the main flows.
- Accessibility lint rules plus component level accessibility assertions.
- SAST, dependency scanning, secret scanning, and a generated SBOM.
- Least privilege CI permissions, no secrets in committed files, and no
  long lived tokens in workflow definitions.
- Secret-bearing CI jobs pinned to a commit SHA, not a mutable tag.
- The release/store-submission job present and documented, even while blocked
  on real credentials, rather than silently absent.
- Branch protection either actually applied (with confirmation on record) or
  clearly flagged as still pending, never merely implied by documentation.
- Decision records for the choices that would otherwise look arbitrary.

## Only on explicit request

Offer these if and only if the user asks for enterprise grade, compliance
certification, or a named vendor. Mention them as available, do not add them by
default: SonarQube or SonarCloud, GitHub Advanced Security with CodeQL, Snyk,
Trivy or Grype, MobSF dynamic analysis, Detox alongside Maestro, Appium with
axe DevTools Mobile, cloud device farms, Fastlane, native fuzzing with AFL++ or
libFuzzer, OWASP ZAP against the backing API, Vault, and SLSA provenance with
signed SBOMs.

## Hard rules

- Do not scaffold before the Expo question is answered.
- Do not mix the two paths. A project must not import `expo` packages while
  being scaffolded as bare React Native, or run `expo` commands from a bare
  project, or hand edit a generated native directory in an Expo project.
- Do not add `any`, `@ts-ignore`, or a widened `tsconfig` to silence an error.
  Fix the type.
- Do not disable a test to make a pipeline green.
- Do not commit generated native directories in an Expo project, and do not
  gitignore them in a bare project. That is the single most visible symptom of a
  scaffolded project that contradicts its own framework choice.
- Do not leave a tool installed but unwired, or wired but not documented.
- Do not tag-pin a third-party action in a job that reads a secret. SHA-pin it.
- Do not apply a branch protection rule, repository setting, or any other
  shared-infrastructure change through an authenticated CLI without first
  showing the user exactly what will change and getting their confirmation.
