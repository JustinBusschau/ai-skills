# Tooling baseline

> Last reviewed: 2026-10-02. The specific tool names, package choices, and
> "current" behaviour mentioned below were correct at that time. Confirm each
> one against current docs or `--help` before relying on it; this file is a
> starting point, per operating principle 1 in `SKILL.md`, not a substitute
> for checking.

This is the pragmatic minimum: mainstream, maintained, free, and sufficient to
satisfy a reviewer asking where the linting, the tests, the accessibility
coverage, and the security scanning are. Each section states the default, the
reason, and what to leave out.

Two rules govern the whole file. First, no version numbers appear here, because
the React Native toolchain moves quickly and a stale pin is worse than no pin:
resolve each package at install time and record what you got. Second, a tool is
only part of the baseline once it has a script in the manifest and a job in
CI.

## Runtime and package management

**Default: the current Node LTS, npm, a committed lockfile, `npm ci` in CI.**

- Pin the Node version in a version file that the package manager and CI both
  read, and repeat it in the manifest's engine field. Two sources that disagree
  is a support ticket waiting to happen.
- Commit the lockfile. CI installs with the clean, lockfile honouring install
  command, never a resolving one. This is the single most effective supply chain
  control and it costs nothing.
- Cache the dependency directory in CI, keyed on the lockfile hash. Caching the
  package manager's own download cache is also fine if your runner supports it.
- `npm audit` is a floor, not a strategy. It produces noise and misses advisories
  outside its own database, which is why dependency scanning below uses a
  second source.

**Why not pnpm or yarn by default:** both are excellent and both are well
supported by modern dependency scanners and Dependabot, so this is a default
for consistency and familiarity, not a claim that npm is more auditable. If
the input or an existing repository already uses pnpm or yarn, use it without
hesitation.

## TypeScript

**Default: `strict` on, `allowJs` off, `noEmit` in a blocking CI job, type aware
linting.**

Set these in the TypeScript configuration. The first two enforce TypeScript
throughout, which is the requirement; the rest are high value, low cost.

- `strict: true`, and do not relax it per file.
- `allowJs: false`, which prevents JavaScript being introduced alongside
  TypeScript. This is the setting that makes "TypeScript throughout" mean
  something.
- `noUncheckedIndexedAccess`, which catches the indexed access bugs that mobile
  code is full of.
- `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noUnusedLocals`, and `noUnusedParameters`.
- `verbatimModuleSyntax` if the bundler and preset support it. Check that it
  does before enabling it, because it changes import syntax requirements.
- `forceConsistentCasingInFileNames`, always.
- Include the application source, the test source, and any configuration
  modules. Exclude generated native directories and build output.

`exactOptionalPropertyTypes` is worth enabling but generates friction with
third party component prop types. Enable it, and if a library's types fight it,
document the exception rather than turning it off globally.

**Enforcement:** a `typecheck` script running the compiler in no-emit mode,
run in CI as its own job, and in the pre-commit hook. Type errors must never be
resolved with `any`, with a suppression comment, or by loosening the
configuration.

**Type aware linting** requires the lint configuration to tell the TypeScript
linter to build a program. With the current typescript-eslint that means
enabling its project service (or an explicit project list) rather than parsing
files in isolation. Without it, a large class of rules silently do nothing,
which is the sort of gap an audit finds.

## Linting

**Default: ESLint flat config, framework base config, type aware TypeScript
rules, hooks rules, React rules, and a small set of React Native rules written
in the repository.**

- Base: the Expo or React Native configuration, extended. Do not write a flat
  config from scratch when the framework publishes one.
- TypeScript: the recommended type checked rule set, plus the rules that matter
  for mobile: no explicit `any`, no floating promises (an unhandled rejection in
  a React Native app is a silent crash), no misused promises, consistent type
  definitions, and no unnecessary conditions.
- React: the hooks rules, including the compiler aware rules if the project
  enables the React compiler. React Native ships the compiler in some
  configurations, so check whether the compiler rules apply before assuming
  manual memoisation is required.
- Formatter compatibility: disable any rule that fights Prettier, rather than
  arguing with the formatter.
- The lint script must fail on errors. Warnings are allowed to accumulate only
  if you record the count and reduce it; a warning budget nobody tracks is not a
  budget.

### The in-repo React Native rules

Write these as a small local ESLint plugin inside the repository (for example
`eslint/rules/`), so they are auditable, reviewable in a pull request, and add
no supply chain surface. This is preferable to a third party plugin for a
baseline, because the rules are few, obvious, and yours.

Cover at least:

1. `Pressable` and touchable components without an accessibility role.
2. `Pressable` and touchable components without an accessibility label or an
   accessible child.
3. Interactive elements with no accessible name.
4. `Image` without an accessibility label, unless it is explicitly marked as
   decorative.
5. Minimum touch target size, enforced by flagging hard coded dimensions below
   the platform minimum rather than by attempting a layout analysis.
6. Text nesting inside a touchable without a wrapping accessible element, which
   is a common source of screen reader confusion.
7. `onPress` on a raw `Text` element, which is invisible to assistive
   technology.
8. `testID` values that do not follow the naming convention, so that the
   end-to-end selectors cannot drift from the tests.
9. Direct writes of secrets to storage, or logging of values assigned to a
   variable whose name suggests a token, password, or personal data. This is
   a naming-convention heuristic, not real taint analysis: it will catch an
   obvious `console.log(token)` and will miss a secret that has been renamed,
   destructured, or passed through another function first. Write it anyway
   because the obvious case is common, but describe it honestly as a
   complement to Gitleaks, not a replacement for it, so nobody mistakes its
   presence for real coverage.
10. `console.log` in application source, or at least a rule that allows it only
    in a logger module.

Keep the plugin small enough to read in one sitting. Ten rules that everyone
understands beat a hundred that everyone disables.

## Formatting

**Default: Prettier, an import sorter, and a package manifest sorter, with a
format check that fails CI.**

- Prettier with no configuration opinions beyond the defaults and a print width
  the project can live with. Do not hand tune indentation and quoting rules.
- An import sorting plugin. Check the current recommended plugin before
  choosing, as this space churns. Its job is to make merge conflicts smaller.
- A package manifest sorting plugin, so dependency blocks stay diffable.
- Two scripts: one that writes, one that checks. CI runs the check.
- The pre-commit hook runs the check on staged files only, via the staging
  wrapper, so the local loop stays fast.

## Git hooks

**Default: Husky plus a staging-aware linter, with a pre-commit hook running the
fast subset.**

The pre-commit hook runs, on staged files only: the formatter check, the
linter, a secret scan (see Gitleaks below; run it here too, not only in CI,
since catching a secret before it enters history is the only version of this
control that actually prevents the leak rather than merely detecting it), and
the type check if it completes in a reasonable time. The full test suite
belongs in CI, not in the hook, because a hook that takes thirty seconds is a
hook developers disable. If Gitleaks cannot be installed locally, do not skip
it silently: say so in the final report (per `verify.md`'s rule on commands
that cannot be run), rely on CI as the sole enforcement point until it can be
installed, and treat that as a gap to flag, not a pass.

Also add a commit message convention only if the user asks for one. A message
linting tool is cheap but it is not part of the quality baseline, and
retrofitting it on an existing repository is disruptive.

## Unit testing

**Not optional. This is the layer that must always exist.**

**Default: Jest with the framework preset, React Native Testing Library, and
enforced coverage thresholds.**

- The preset comes from the chosen framework (see `decision-expo.md`). The
  framework's preset exists so that native modules are stubbed correctly; a
  hand written preset will drift.
- React Native Testing Library is the component testing layer, and it replaces
  the deprecated test renderer. Check the current major, because recent majors
  made the render and interaction APIs asynchronous, which changes how your tests
  await.
- A setup file that registers the matchers and any global mocks. Keep global
  mocks to a minimum and record why each one exists, because a growing list of
  global mocks is the main cause of a suite that passes while the app breaks.
- Test placement: colocate unit tests next to the source, or use a mirrored test
  directory. Pick one and apply it everywhere.
- Coverage thresholds in the Jest configuration, enforced in CI from the first
  commit so the mechanism is proven, but set the initial floor to what the
  scaffolded code actually achieves (often far below eighty percent, since a
  fresh project has little logic yet) rather than an arbitrary round number.
  An 80% target imposed on day one, before there is meaningful logic to
  cover, invites tests written to hit the number rather than to check
  behaviour. Raise the floor deliberately as real logic is added, and say in
  the README that the starting number is a floor that ratchets up, not a
  target that was already met. Give the ratchet a mechanism, not just an
  intention: add a step to the coverage script that compares actual coverage
  against the committed floor and warns (or fails) when actual coverage
  exceeds it by a large margin, for example twenty percentage points, so a
  stale floor becomes a visible, actionable signal rather than something a
  team has to remember to revisit on its own. Record the review cadence (for
  example, revisit at each minor release) in the tooling architecture
  decision record.
- Exclude generated native directories, vendored mocks, and the test setup file
  from coverage, and say so in the configuration, so the number is honest.
- Run a lint rule that fails on a skipped or focused test in a committed change,
  or at minimum a CI grep for them. A test suite full of skips is worse than a
  small honest suite.

Prefer behavioural assertions driven by accessible queries (by role and name)
over snapshot assertions and over internal state inspection. Snapshots of native
render output are noisy and frequently fail for reasons unrelated to behaviour.

## End-to-end testing

**Required for the main user flows. Explicitly not required for every screen,
and that distinction should be written into the README so nobody treats the
absence of a flow test as a defect.**

**Default: Maestro, with flows tagged by criticality and run on an emulator.**

Why Maestro rather than Detox: Maestro drives the real application through YAML
flows that do not require instrumented native builds, it works against Expo
prebuild and bare projects alike, and it needs no additional native test runner
in the repository. Detox remains a reasonable choice if the team wants
grey-box tests synchronised against the React Native bridge, or if it is
already in use. Ask rather than assume, but default to Maestro.

During scaffolding, install the real Maestro CLI and use it to validate every
flow file's syntax and to confirm every selector matches a `testID` that
exists in source. Do not attempt to boot an emulator at this stage: most
environments this skill runs in cannot do that reliably, and a hung boot
attempt wastes time without changing the outcome. Running a flow against a
real emulator is the user's first manual check after handover, and the final
report should say so plainly rather than implying it was covered. If the
Maestro CLI itself cannot be installed in the current environment (no
network, a missing prerequisite such as Java), do not treat that as a silent
pass: fall back to reading the flow YAML directly, and say plainly in the
final report, per `verify.md`'s rule on commands that cannot be run, that the
real syntax check was not performed and why.

Maestro's own installer is a `curl | bash` script. Read it, or at least check
its published checksum, before running it rather than piping it blindly, and
pin the install to a specific released version rather than whatever `latest`
resolves to on the day you happen to scaffold, so a future CI run does not
silently pick up a different Maestro version than the one you verified
locally.

- A single flows directory at the repository root, one file per flow, named
  after the user journey rather than the screen.
- Every flow starts by clearing application state, so flows cannot leak into
  each other.
- A criticality tag on each flow, applied consistently, for example a smoke tag
  for the main journeys. CI runs the smoke tag on every pull request and the
  full suite on a nightly schedule.
- Every selector the flows use is a `testID` that follows a naming convention
  enforced by the in-repo lint rule. Do not select by screen position, and do
  not depend on the order of text on a screen.
- A helper directory with shared steps (sign in, dismiss a dialog, wait for a
  screen) so that a change to a shared flow is a change in one place.
- Interactable elements on the main flows carry a `testID` even if no end-to-end
  test uses it yet, so the tests can be added without touching the UI code.
- A documented list of which flows are the main ones, in the README, with the
  reasoning. This is the artefact that makes "required for main flows" auditable.
- A stable seed or fixture for test accounts, supplied as CI secrets rather than
  committed.
- Retry on flakiness at the flow level, not by editing the assertion, and a
  policy that a flow which needs more than a small number of retries is a real
  defect.

CI needs an emulator. On GitHub Actions, the common routes are a hosted
Android emulator action, or a macOS runner with an iOS simulator. Either way, the
workflow must boot the emulator, wait until it is actually ready, run the flows,
and always upload logs and screenshots on failure, using an artifact upload that
runs regardless of the job outcome.

## Accessibility testing

**Required. Three layers, because no single tool covers it.**

### Layer one: static rules

The in-repo ESLint rules cover most of the first layer, and they are the cheapest
to run because they run on every commit. Additionally, and only if it installs
cleanly against your current ESLint major, you can add a maintained community
React Native accessibility plugin. If it does not install cleanly, drop it and
rely on the in-repo rules, because a plugin that needs a legacy configuration
format is a liability in an audit.

### Layer two: component level assertions

Ship a small accessibility assertion helper in the test source, and use it in
the component tests. It should walk the rendered tree and assert the things
that actually break in production:

- Every interactive element has an accessible name and a role.
- No two interactive elements share an accessible name where that would make
  them indistinguishable to a screen reader user.
- Every image is either labelled or explicitly marked decorative.
- Interactive elements meet the platform minimum touch target.
- No element is hidden from accessibility in a way that is not intentional, and
  any element that is hidden is asserted deliberately rather than by accident.

Then add a test that renders each main screen and runs the helper against it.
This gives real coverage of the main flows, and it is enforceable in CI, which
the lint rules alone are not.

### Layer three: manual procedure

Automated tooling cannot drive VoiceOver or TalkBack, and no free tool in this
stack can. Write this down rather than pretending otherwise. The documentation
should include:

- The VoiceOver checklist for iOS and the TalkBack checklist for Android,
  covering navigation order, labels, focus visibility, and form completion.
- Using the platform's own accessibility inspector on a real build.
- The text scaling check, including the maximum font size multiplier, since
  fixed heights break at large text sizes and this is a common and cheap
  regression to catch.
- The reduced motion check.
- The colour contrast check against the design tokens.
- A named owner and a release gate, so the manual step is a responsibility
  rather than a good intention.

If the user explicitly asks for automated screen reader coverage, that is the
cue to offer the enterprise option (Appium with a commercial accessibility
engine), and to be clear about the cost and the extra maintenance.

## Static and dynamic analysis

**Default: four tools, all free, all runnable locally and in CI.**

| Tool | Job | Where it runs |
| --- | --- | --- |
| Semgrep (command line, community edition) | Static analysis of JavaScript, TypeScript, and the native languages present, plus secret patterns. Run its community rule sets for defaults, security, and secrets. | Repository script and CI, failing the build on high severity findings. |
| OSV-Scanner (Google's open source scanner) | Known vulnerabilities across the whole lockfile, from the OSV database, which is broader than the package manager's own advisory source. Free, a single CLI command, and needs no account or API key. | Repository script and CI, failing on high and critical. |
| Gitleaks | Secret detection with a well understood configuration and output format that reviewers already know. | Pre-commit hook and CI. The pre-commit hook is the version of this control that actually prevents a leak; CI is the backstop for anyone who bypasses the hook. |
| A licence checker | An allow list of permitted licences, so a copyleft or unknown licence in a dependency is a build failure rather than a surprise. | CI, with the allow list committed. |

Notes on each:

- **Semgrep.** Run it through its CI mode so that findings are attributed to the
  pull request that introduced them, which is what stops a new project from
  being permanently red on day one. The community edition analyses within a
  single function or file, which is a real limitation: be honest about that in
  the README rather than implying full dataflow coverage. Commercial cross
  file analysis is an explicit request, not a default.
- **Dependency scanning.** Run at least two sources, because each misses what
  the other catches. OSV-Scanner is the pragmatic default: a single command
  against the lockfile, no account, a broad database. Confirm its current
  invocation with its own `--help` or docs before scripting it, same as any
  other tool here. If the project or organisation already has a different
  scanner mandated, use that instead; the point is a second source beyond
  `npm audit`, not this specific tool. Enable automated dependency update pull
  requests as well, configured to open pull requests rather than to merge, and
  grouped by severity so a week of patch pull requests is manageable.
- **Secrets.** Gitleaks in CI is the audit expectation. A baseline file is
  acceptable for an existing repository that already contains findings, and must
  be reviewed and committed, never generated silently.
- **Licences.** Commit the allow list. A permitted list of common permissive
  licences plus a rule that anything outside it fails, is the minimum a reviewer
  will accept.

**Additionally, and by default:**

- **An SBOM.** Generate one in CI from the lockfile using a maintained
  generator, and upload it as a build artifact. This is cheap, it is asked for
  constantly, and it is the difference between "we can answer a vulnerability
  question" and "we cannot".
- **Dependency review on pull requests**, where the CI platform actually
  provides it at no cost: on GitHub this is free on a public repository but
  requires GitHub Advanced Security on a private one (see `ci.md`), and other
  platforms have their own equivalents with their own conditions. Confirm
  which case applies before promising it in the README. Where it does apply,
  it blocks a pull request that introduces a known vulnerable or newly
  licensed dependency, which is more targeted than a full scan on every run.
- **A production bundle smoke test**, which is the cheapest genuine dynamic
  check in the whole stack: it proves the application actually bundles for
  release. It catches import errors, environment variable mistakes, and
  platform-specific resolution failures that no unit test will find. For Expo,
  that is the export command; for bare React Native, that is the bundle command.
  Run it in CI and fail on error.
- **Framework diagnostics.** On the Expo path, the framework's own doctor
  command in CI. It validates SDK and dependency compatibility and is the most
  valuable single job on that path.
- **Native linting**, only where native source exists. For a bare project, the
  Android lint task and, on a macOS runner, a lightweight iOS static analysis
  step. Skip both for an Expo project with no generated native source.

**Dynamic analysis** proper (running the app and probing it) is out of scope for
the baseline, because it needs an instrumented build, a device or emulator, and
usually a commercial tool. If the user asks, offer the free mobile security
framework in a container as the starting point, with an honest note about its
runtime, and a scanner for the backing API as the complement. Both are on the
"only on explicit request" list.

## Store submission readiness

Not a testing or analysis tool, but a documentation obligation that is cheap
to meet and easy to forget until a submission is rejected for it. See
`references/app-store-compliance.md` for the checklist: the iOS privacy
manifest and usage-description strings, and the Android permission and Data
Safety declarations. Produce the checklist even before the app uses any of
the capabilities that trigger these requirements, so it is updated as a habit
rather than discovered as a blocker the week of submission.

## Deliberately not in the baseline

Do not add these without being asked, and if the user does ask, say what each
one costs:

SonarQube or SonarCloud, GitHub Advanced Security with CodeQL, Snyk, Trivy or
Grype, the mobile security framework for dynamic analysis, Detox alongside
Maestro, Appium with a commercial accessibility engine, cloud device farms,
Fastlane for store submission, native fuzzing, an API scanner against the backing
service, Vault, and signed build provenance.

## Wiring it up

For each tool you add:

1. Add the script to the manifest with a predictable name (lint, lint:fix,
   format, format:check, format:fix, typecheck, test, test:coverage, and one
   script per analysis tool).
2. Add a job in CI that runs exactly that script, with no duplicated command
   strings between the workflow and the manifest.
3. Document it in `README.md` and `AGENTS.md`.
4. Run it locally and record the result, so a red pipeline is never the first
   time a finding appears.
