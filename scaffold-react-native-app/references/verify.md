# Verification

> Last reviewed: 2026-10-02. This file is a starting point, per operating
> principle 1 in `SKILL.md`, not a substitute for confirming anything
> version-specific against current docs.

A scaffolded project is not finished when the files are written. It is finished
when every command in it has been run and the results are known. This file is the
checklist, in the order to run it.

## The rule

Run each command, read the output, and fix what fails. Do not report a check as
passing because the configuration looks right. If a command cannot be run in the
current environment (no emulator, no macOS, no Android SDK, no network), say so
explicitly in your final report rather than implying it passed.

## Checklist

### Type checking and linting

- The type check runs clean across the application, the tests, and any
  configuration modules. No errors, and no errors hidden by excluding a
  directory to make the run pass.
- The linter runs clean. Confirm the type aware rules are actually active by
  introducing a temporary violation that only a type aware rule would catch, and
  checking that it fails. If it does not fail, the project service is not wired
  up and the rules are decorative.
- The formatter check runs clean.
- The React Native rule plugin is active: temporarily add a `Pressable` with no
  accessibility role and confirm the lint fails. Then remove it.
- No `any`, no suppression comments, and no loosened compiler options anywhere
  in the source.

### Tests

- The unit suite runs clean, and the test count is greater than zero. A project
  scaffolded with no tests has failed this skill.
- Coverage is generated and the thresholds are enforced, not merely printed.
  Confirm enforcement by temporarily raising a threshold above the current
  coverage and checking the run fails.
- There is a component test for a representative component and a component test
  for a representative screen or main flow.
- The accessibility assertion helper is used in at least one test, and it
  genuinely fails when given a component with an unlabelled touchable.
  Confirm by writing a deliberately broken component, checking the failure, and
  then removing it.
- No skipped or focused tests are committed.

### End-to-end

- The flow directory contains at least one flow for each main user flow named in
  the brief, plus the flows directory README that lists them and explains why
  those were chosen.
- Every flow clears application state before it starts.
- Every selector in every flow is a `testID` that follows the enforced naming
  convention, and every such identifier exists in the source. A selector that
  matches nothing is a test that passes forever without testing anything.
- The criticality tags are applied consistently.
- Install the real Maestro CLI and run its own syntax check against every
  flow file; do not rely solely on your own reading of the YAML. Do not
  attempt to boot an emulator during scaffolding by default: most
  environments this skill runs in cannot do it reliably, and a stuck boot
  wastes time without changing the outcome. Say plainly in your final report
  that a real run against an emulator was not attempted, and that it is the
  user's first manual check before relying on the suite.

### Build

- The production bundle command succeeds for both platforms. This is the check
  that catches the environment variable and platform resolution problems that
  unit tests cannot see.
- The Node version installed is confirmed against the framework's actual
  supported range for the versions the generator resolved, not only checked
  in isolation. A Node version that merely "looks current" can still be
  outside the window the resolved React Native or Expo release supports.
- For the Expo path, the framework's doctor command is clean. Treat warnings as
  failures during the scaffold, because they are the framework telling you the
  project contradicts its own choice.
- For the bare path, the Android assemble and, on macOS, the iOS build of the
  native target, at least in a debug configuration.
- Nothing in the working tree changed as a side effect of a build that should
  have been ignored. Check the ignore file by building and then inspecting what
  is untracked.

### Security and dependency posture

- The secret scan runs clean, and it is genuinely scanning (introduce a fake
  credential in a scratch file, confirm it is caught, then remove the file).
- The dependency scan runs clean, or its remaining findings are recorded and
  triaged in writing rather than suppressed wholesale.
- The static analysis runs clean, and its rule sets include the secret patterns.
- The licence check runs against the committed allow list.
- The SBOM generates.
- No real secret, API key, or credential is present anywhere in the tracked
  files, and the environment example file contains names only.
- Every `process.env` reference in the application source has a matching
  entry, name only, in `.env.example`. Grep for one against the other; drift
  here is how a required variable goes undocumented until a new
  contributor's first build fails.
- The release/store-submission CI job exists, is clearly marked as blocked
  pending real credentials, and its secrets checklist in the README names
  every secret it reads. This job should fail in a clearly explained way if
  run today, not silently or with a cryptic error.

### Consistency of the framework decision

Re-run the enforcement sweep from `decision-expo.md` after all tooling is added,
because it is easy to reintroduce a contradiction by adding a package with the
bare installer. Specifically check:

- No package from the other framework is present in the manifest.
- The Jest preset, the ESLint base, and the TypeScript base all match the chosen
  path.
- The native directories are committed or ignored as the path requires.
- Every script in the manifest belongs to the chosen path.
- Every CI job belongs to the chosen path.

### Documentation

- The README's scripts table matches the actual scripts, and every script listed
  actually runs.
- The architecture decision records exist for the framework decision and the
  tooling baseline, and the framework decision record contains the enforcement
  sweep result.
- `AGENTS.md` states the dependency rule (install through the framework's own
  installer on the Expo path, never the bare package manager) prominently, since
  it is the rule most often broken by a well-meaning new contributor.
- `SECURITY.md` exists and says how to report a vulnerability.
- The required branch protection status checks are documented, and the names
  match the jobs in the workflow. State plainly whether the rule was actually
  applied to the remote repository (because you had authenticated access and
  the user confirmed it) or only documented and still pending.
- If the brief named a compliance target such as WCAG 2.2 AA, the
  documentation says plainly that the automated tooling narrows risk and does
  not itself certify conformance.

## Final report

Write the handover in prose, covering:

1. What was scaffolded, and the versions the generator actually chose (not the
   versions you intended).
2. The two decisions, and the reasoning recorded for each.
3. Every check you ran, with its result. Group the passing ones and call out the
   failures you fixed.
4. What you could not run in your environment, stated plainly, with the reason.
   This matters more than a clean-looking list.
5. What you deliberately left out, and what would trigger you to add it.
6. The first three things a new contributor should read.

Do not pad the report. The reader wants to know what works, what does not, and
what they have to decide.
