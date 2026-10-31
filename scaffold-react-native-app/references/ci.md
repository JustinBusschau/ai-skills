# CI/CD

> Last reviewed: 2026-10-02. Specific commands, flags, action names, and
> "current" platform behaviour mentioned below were correct at that time.
> Confirm each one against current official docs before relying on it; this
> file is a starting point, per operating principle 1 in `SKILL.md`, not a
> substitute for checking.

The job graph is platform independent. Only the syntax changes. Write the
pipeline so that cheap, blocking checks run first, and so that a red pipeline
costs the developer a minute rather than thirty.

## The job graph

| Order | Job | Trigger | Blocking | Notes |
| --- | --- | --- | --- | --- |
| 1 | Lint, format check, type check | Every push and pull request | Yes | No build, no emulator. Cached dependencies. |
| 2 | Unit tests with coverage floor | Every push and pull request | Yes | Coverage thresholds enforced, not just reported. |
| 3 | Static analysis, dependency scan, secret scan, licence check | Every push and pull request | Yes, on high and critical | Attribution limited to the pull request where the platform supports it. |
| 4 | Production bundle smoke test | Every push and pull request | Yes | Proves the app bundles for release. |
| 5 | End-to-end, smoke-tagged flows | Every pull request | Yes | Android emulator by default; add a macOS runner with an iOS simulator only as an explicit, documented opt-in (see Emulator cost awareness below). |
| 6 | Full end-to-end suite | Nightly, and on release branches | No, but it fails the build for its own run | All flows, Android by default; both platforms only once iOS has been explicitly opted into. |
| 7 | SBOM generation and artifact upload | Every successful build | No | Cheap, and asked for constantly. |
| 8 | Native build (signing, store submission) | On tags or release branches | No | Always scaffolded, even before real credentials exist. Marked as blocked with a comment and a README checklist of exactly which secrets it needs, uses credentials from CI secrets only, never from committed files. |

Jobs 1 to 4 need no credentials and no secrets. That is deliberate: a pipeline
where the lint job needs a signing certificate is a pipeline nobody trusts.

## Universal rules

- **Pinned runtime.** The Node version comes from the version file in the
  repository, not from whatever the runner image ships.
- **Clean installs only.** Use the lockfile honouring install command, with the
  committed lockfile. Never a resolving install in CI.
- **Least privilege.** Default every job to read only permissions, and grant more
  per job only where required. For GitHub specifically, set the top level
  permissions block to read only and elevate per job, since the default
  otherwise varies with repository settings.
- **Cache, keyed on the lockfile.** Cache the dependency directory or the
  package manager's download cache, keyed on the lockfile hash, so a lockfile
  change invalidates it.
- **Concurrency.** Cancel in-progress runs for the same branch. A superseded
  build is wasted compute.
- **Timeout.** Set a timeout on every job. A hung emulator should fail, not bill
  you until the runner is reclaimed.
- **No secret in a log.** Mask every secret, and never echo an environment file.
- **Action versions, tiered by exposure.** Pin any third party action used in a
  job that reads a secret (the release job, and any job uploading SAST
  results) to a full commit SHA, which an upstream compromise or a re-pointed
  tag cannot silently change underneath you. Jobs that never see a secret
  (lint, format, type check, unit tests, the bundle smoke test) can use the
  simpler released version tag. This is a deliberate default, not merely an
  option: a pipeline where the lint job and the signing job trust an upstream
  tag equally is trusting the wrong jobs equally. Dependabot (or the
  platform's equivalent) still opens update pull requests for SHA-pinned
  actions, keeping the human-readable version in a comment, so this does not
  add meaningful maintenance burden. The same tiering applies outside GitHub
  Actions, in whatever form the platform uses for third-party code: GitLab CI
  included templates and components, and Jenkins shared-library references
  and plugin versions. Pin the version precisely (a commit SHA or an exact
  release, not a floating branch or "latest") for anything used in a
  secret-bearing stage, and allow the looser convention elsewhere. Where the
  platform has no automatic update mechanism equivalent to Dependabot, note in
  the README that these pins need manual, periodic review.
- **Emulator cost awareness.** A macOS runner needed for an iOS simulator costs
  several times more per minute than a Linux runner on most platforms. Default
  the automatic emulator jobs (job 5 and job 6) to Android only, and make iOS
  end-to-end coverage an explicit, documented opt-in. Say this in the README
  in plain terms so the decision to turn it on is made with the cost in view,
  not discovered on an invoice.
- **The manifest is the single source of truth for commands.** CI calls
  `npm run lint`, not `npx eslint .`. Otherwise the two drift and a green
  pipeline proves nothing.
- **Branch protection: apply it if you safely can, document it regardless.** A
  passing pipeline with no protection rules on the default branch protects
  nothing. If the repository already exists on the remote platform and you
  have authenticated access, show the user exactly which status checks and
  rules you are about to require, get their explicit confirmation, and only
  then apply it (for example with `gh api repos/.../branches/.../protection`
  or the GitLab equivalent). Never apply it silently. Either way, put the
  required status checks in the README, and say plainly in your final report
  whether the rule was actually applied or only documented.

## GitHub Actions

Suggested layout:

```
.github/
  workflows/
    ci.yml            # jobs 1 to 5, on pull request and push to main
    nightly.yml       # jobs 6 and 7, on a schedule and manual dispatch
    release.yml       # job 8, on tags
  dependabot.yml      # npm, and GitHub Actions updates
  CODEOWNERS
```

Points worth getting right:

- One workflow for the fast path so that pull requests get a single, predictable
  status check, plus a scheduled workflow for the expensive path, plus a
  release workflow triggered by tags.
- Split lint, type check, and unit tests into separate jobs rather than one
  combined job, so the developer sees which check failed without opening a log.
  Combine them only if the repository is very small.
- Use a matrix for the Node version, or pin to a single version if the project
  only supports one. A matrix is honest; a single pinned version is a supported
  platform statement. Pick the one you can maintain.
- For the emulator job, use a maintained community action for booting and
  headless Android, or a macOS runner plus the iOS simulator tooling. Either
  way, wait for the device to be fully ready before running flows, and upload
  the flow artefacts (logs, screenshots, and the failure output) in a step that
  runs even when the test step fails. In the platform's syntax that is an
  "always" condition on the upload step.
- Enable the platform's own dependency review on pull requests, where it is
  actually available: GitHub's Dependency Review Action is free and needs no
  extra configuration on a public repository, but on a private repository it
  requires GitHub Advanced Security, which is a paid add-on. Check which case
  applies before promising it in the README; if it is not available, say so
  and rely on the dependency scanner script instead.
- Configure automated dependency updates to open pull requests, grouped, with
  patch updates separated. Do not enable auto-merge by default: an unreviewed
  dependency change is a supply chain risk, and that is a decision the user
  makes, not you.

## GitLab CI

Use a single file at the repository root, with `stages` for lint, test, scan,
verify, and build. The same rules apply: pinned Node image tag, the clean
install command, dependency caching keyed on the lockfile, jobs grouped by
`stage`, and the expensive end-to-end job either in a scheduled pipeline or
gated behind a merge request variable so it does not run on every commit.

GitLab's built-in template coverage and dependency scanning templates are
available and free at the group or project level. Offer them as an addition
rather than building a substitute, since they integrate with the platform's
security dashboard and a reviewer will expect results to land there.

Pin any included external template or component used in the build or release
stage to an exact version, not a floating branch, for the same reason
third-party actions are SHA-pinned on GitHub (see Universal rules above).

## Jenkins

Provide a declarative `Jenkinsfile` at the repository root. Use a shared agent
label per platform rather than assuming a node's capabilities, and use the
credentials binding plugin for anything secret. The structure is:

- A fast stage that runs the lint, format, type check, and unit test scripts,
  on a general purpose agent.
- A scan stage running the static analysis, dependency, secret, and licence
  scripts.
- A verify stage running the bundle smoke test.
- An end-to-end stage on a dedicated Android or iOS agent, with the emulator or
  simulator pre-provisioned, and the Maestro flow artefacts archived with
  `archiveArtifacts` so a failure is diagnosable.
- A build and release stage gated on a tag, with signing credentials bound from
  the credentials store and never present in the workspace as a file.
- A `post` block that always publishes the results, so a failed job is
  diagnosable.

For Jenkins, also add:

- A `post { always { archiveArtifacts ... } }` equivalent, which is the Jenkins
  idiom for the always-run upload step used elsewhere.
- A timeout on the end-to-end stage, since a stuck emulator on a long-lived
  agent is expensive.
- Documentation of the agent labels a new developer needs, in the README, because
  a new joiner's first pull request failing on a missing agent is a bad first
  day.
- Pin the exact version of any shared library or plugin used in the
  signing/release stage (the Jenkins equivalent of the tiered SHA-pinning rule
  above), since that stage is the one with secret access.

If the organisation already has a shared library for pipelines, offer to build
the Jenkinsfile on top of it rather than writing a standalone one, but do not
assume it exists.

## Other platforms

CircleCI, Bitrise, and Codemagic all support the same job graph. The migration
is mechanical: map the scripts to jobs, pin the runtime, use the clean install,
and keep the same ordering. If the user names one of these, write the
configuration for it rather than forcing GitHub Actions.

## Pre-merge versus pre-push

The Git hook covers the fast subset locally (see `tooling.md`). CI covers
everything, including the fast subset again, because a hook can be bypassed with
a flag and CI is the record. Do not try to make the hook authoritative.

## Finishing

After writing the pipeline:

1. Validate the syntax locally. For YAML, parse it with a parser. For GitHub
   Actions specifically, install and run `actionlint` rather than treating it
   as optional, since a valid YAML file can still reference a non-existent
   job, use a bad expression context, or misname a secret, none of which a
   plain YAML parser will catch. If `actionlint` genuinely cannot be installed
   in the current environment, fall back to the plain YAML parse and say so
   explicitly in the final report rather than implying the stronger check ran.
2. Check that every script the pipeline calls exists in the manifest. A pipeline
   calling a script you renamed fails on the first run, in public.
3. Check that every secret the pipeline reads has a documented name in the
   README and in the environment example file, and that no secret has a default
   value in the workflow.
4. Confirm the required status checks are documented, and that they match the
   actual job names in the workflow. Mismatched names mean a required check that
   never reports, which either blocks every pull request or is quietly removed.
5. Report honestly which jobs you could not execute in your environment, and
   which will first run when the repository is pushed.
