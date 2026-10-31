# The Expo decision and its enforcement

> Last reviewed: 2026-10-02. The specific flag names, package names, and
> framework-version claims below (for example `typedRoutes`, or which
> architecture mode is current) were correct at that time. Confirm each one
> against the official docs or `--help` before relying on it; this file is a
> starting point, per operating principle 1 in `SKILL.md`, not a substitute
> for checking.

This file covers the two supported paths, how to scaffold each one, and the
sweep that proves the choice is enforced consistently across the repository.

## Asking

Ask once, in the same call as the CI platform question, and always offer both
options. Do not recommend Expo unconditionally: it is the sensible default for
most projects, but a bare project is a legitimate choice when the team owns
native code, needs a custom native module, or has a build pipeline that must
produce signed artefacts on its own infrastructure.

Suggested framing: "Should this project use Expo, or plain React Native with the
community CLI? Expo is the recommended default because it removes native build
management and gives you over-the-air updates. Plain React Native keeps the
`ios` and `android` directories in the repository and is the right choice if you
need custom native modules or own your build pipeline."

If the user answers Expo, do not ask anything else about it. If the user answers
plain React Native and mentions a reason such as a custom native module or an
existing native codebase, note that reason in the architecture decision record.

## Path one: Expo

### Scaffolding

Use the official generator with the TypeScript template. Confirm the template
name with `npx create-expo-app@latest --help` before running, because the
default template and its flags change between releases. Confirm the current
flag name for typed routes in Expo Router's documentation (it has been
`typedRoutes`, but check before typing it) and enable it, and put a
placeholder route in place of the template's demo screen so the route tree
matches the brief.

Where the brief has multiple flows, create real routes rather than a single
screen. File based routing is the point of the choice, so an empty route tree
undermines it.

### What the choice means everywhere

| Surface | Consequence of choosing Expo |
| --- | --- |
| Native dependencies | Always installed with the Expo installer (`npx expo install`), never with the bare package manager, so versions stay inside the SDK compatibility window. |
| Native directories | Generated, not authored. `ios` and `android` are produced by the prebuild step and are gitignored. Never hand edit them. |
| Custom native configuration | Expressed as config plugins or build properties in the app config, not as edits to generated files. |
| App configuration | A typed, dynamic config module (the TypeScript form of the app config) rather than a hand maintained JSON file, so that per-environment values come from environment variables. |
| Navigation | File based routing is the natural fit. If imperative navigation is genuinely required, the packages still come from the Expo installer. |
| Linting | The Expo ESLint configuration as the base, extended with your own rules. |
| Unit testing | The Expo Jest preset, not the bare React Native one. |
| Diagnostics | The Expo doctor command in CI, which validates SDK and dependency compatibility. |
| Building | The Expo build and submit services, invoked from CI with the project id and token held as repository secrets. |
| Local native runs | The Expo run commands, which wrap the native build. Do not invoke Gradle or CocoaPods directly for a normal workflow. |
| Type checking | The Expo TypeScript base configuration, extended, with `strict` and `allowJs: false` preserved. |

### What must not appear in an Expo project

- A bare `npm install` of a package with native code.
- A hand edit to anything under `ios` or `android`.
- A committed `ios` or `android` directory.
- The bare React Native Jest preset.
- Direct Gradle or CocoaPods invocation in a script or a workflow, except in a
  genuinely custom build step that is documented as such.
- An `expo` import anywhere in a project that chose bare React Native.

## Path two: plain React Native (bare)

### Scaffolding

Use the community CLI initialiser. Confirm the invocation with
`npx @react-native-community/cli@latest init --help` before running, since the
package name and flags have moved over time. Use the TypeScript template the
generator offers by default, and verify that `tsconfig.json` exists and is
picked up by the generated project.

### What the choice means everywhere

| Surface | Consequence of choosing bare React Native |
| --- | --- |
| Native dependencies | Installed with the package manager, pinned in the lockfile, and each must be checked for New Architecture compatibility. |
| Native directories | Authored and committed. `ios` and `android` are first class source. |
| Dependency updates | Regenerate `Podfile.lock` and the Gradle lockfiles deliberately, and review the diff, because a bare upgrade touches native code. |
| Linting | The React Native ESLint configuration, converted to flat config, extended with your own rules. |
| Unit testing | The React Native Jest preset. |
| Diagnostics | No framework doctor. Substitute the framework upgrade helper or the CLI's own checks, plus the project scripts. |
| Building | Native builds in CI: Gradle for Android, the native build tool for iOS, with signing credentials supplied as CI secrets. |
| Type checking | The generated TypeScript configuration, extended with `strict` and `allowJs: false`. |
| Architecture | Confirm in the current React Native docs whether the New Architecture is still the only supported mode, or whether a flag still exists to negotiate it; this was true for recent releases at the time of writing, but is exactly the kind of claim that goes stale. Do not add code that assumes the old bridge either way. |

### Bare project escape hatch

There is an officially supported way to consume individual Expo packages from a
bare project, without adopting the Expo CLI, the Metro plugin, or the hosted
build service. This is a legitimate, documented tool for a bare project that
needs, for example, secure storage or an image picker. Treat it as an explicit
decision: if you use it, record it in the architecture decision record, and keep
it out of the rest of the project. Do not let it become a half migration.

## Release credentials, for both paths

Neither path can actually produce a submittable build without accounts and
credentials that this skill cannot create for you. For Expo: an Expo account,
an EAS project (`eas init`), and an access token held as a CI secret. For bare
React Native: an Apple Developer account and a distribution certificate and
provisioning profile for iOS, and a signing keystore for Android, both
supplied to CI as secrets, never committed. Scaffold the release CI job
regardless (see `ci.md`), mark it blocked, and list exactly these in the
README's secrets checklist so the user knows precisely what to go and create.

## The enforcement sweep

Run this immediately after scaffolding and before adding any tooling. It is the
check that the answer to the Expo question is real rather than cosmetic. Work
through every row and correct each surface that contradicts the decision.

| Check | How to verify |
| --- | --- |
| Every native dependency came from the framework installer | Inspect the lockfile or reinstall from scratch; the Expo installer writes SDK-compatible versions, the bare installer does not. |
| No wrong-framework package is present | Search the manifest for framework packages that do not belong on the chosen path. |
| The Jest preset matches the path | Read the Jest configuration. |
| The ESLint base config matches the path | Read the ESLint configuration. |
| The TypeScript base configuration matches the path | Read `tsconfig.json` and confirm it extends the right base. |
| The app config is typed and dynamic | For Expo, the config is a typed module, not a static JSON file. |
| Native directories are handled correctly | Committed for bare, generated and gitignored for Expo. |
| The ignore file matches the path | A bare project ignores build output but not the native sources; an Expo project ignores the generated native directories. |
| Every script in the manifest belongs to the chosen path | Read `package.json` end to end and remove or replace any command that belongs to the other one. |
| Every CI job belongs to the chosen path | Read the workflow or pipeline file and check each build and run step. |
| Navigation packages are compatible with the path | Confirm they are installed through the framework installer on the Expo path. |
| The documentation agrees | The README, `AGENTS.md`, and the architecture decision record all state the same choice. |
| The framework's own diagnostic is clean | For Expo, the doctor command reports no errors. For bare, the generator's checks pass. |

Record the sweep result in the architecture decision record, since a reviewer
will want to see that the decision was verified rather than assumed.
