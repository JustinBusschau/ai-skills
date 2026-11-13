# CI/CD

> Last reviewed: 2026-11-13. Specific commands, flags, action names, and
> "current" platform behaviour mentioned below were correct at that time.
> Confirm each one against current official docs before relying on it; this
> file is a starting point, per operating principle 1 in `SKILL.md`, not a
> substitute for checking.

The job graph is platform independent. Only the syntax changes. Cheap,
blocking checks run first, so a red pipeline costs the developer a minute
rather than ten.

## The job graph

| Order | Job | Trigger | Blocking | Notes |
| --- | --- | --- | --- | --- |
| 1 | Lint, format check, type check | Every push and pull request | Yes | No build. Cached dependencies. Separate jobs or steps so the failing check is obvious. |
| 2 | Unit and component tests with coverage floor | Every push and pull request | Yes | Thresholds enforced, not just reported. Coverage report uploaded as an artefact. |
| 3 | SAST, dependency scan, secret scan, licence check | Every push and pull request | Yes, on high and critical | Diff-aware on pull requests where the tool supports it. |
| 4 | Build, `dist/` secret scan, bundle size budget | Every push and pull request | Yes | Upload `dist/` as an artefact for job 5 and job 7, so the same bytes are tested and deployed. |
| 5 | End-to-end smoke and page-level accessibility, Chromium | Every pull request | Yes | Downloads the job 4 `dist/` artefact and serves it with `vite preview` (Playwright's `webServer` must not rebuild in CI). If the signed-in flows need the mock-auth bundle (see `tooling.md`), this job also builds it with `--mode e2e` into `dist-e2e/` and runs those flows against it. HTML report and traces uploaded even on failure. |
| 6 | Full end-to-end suite across Chromium, Firefox, and WebKit, plus SBOM | Nightly, and on release branches | Fails its own run | Linux runners cover all three engines, so there is no expensive macOS runner to justify here. |
| 7 | Deploy, then post-deploy header check | Default branch or tags, depending on the release model | No | Always scaffolded. Marked blocked until the hosting resources and credentials exist. Reads secrets, so its third-party actions are SHA-pinned. |

Jobs 1 to 5 need no secrets (unless the end-to-end suite runs against a real
test environment, in which case job 5 reads test credentials and its actions
are SHA-pinned too).

## Universal rules

- **Pinned runtime.** Node from `.nvmrc`, not from the runner image.
- **Clean installs only.** `npm ci` against the committed lockfile.
- **Least privilege.** Read-only permissions by default; elevate per job only
  where needed. On GitHub, set the top-level `permissions` to `contents: read`
  and grant `id-token: write` only on the deploy job (for OIDC) and
  `pages: write` only on a GitHub Pages deploy.
- **Cache keyed on the lockfile**, and the Playwright browser cache keyed on
  the installed Playwright version.
- **Concurrency.** Cancel in-progress runs for the same branch, except the
  deploy job, which must not be cancelled halfway through an upload.
- **Timeouts** on every job.
- **No secret in a log.** Never echo an environment file.
- **Build once, deploy the tested artefact.** The deploy job downloads the
  `dist/` artefact from job 4 rather than rebuilding, so what was tested is
  what ships. If per-environment `VITE_` values make that impossible, build
  per environment in a matrix and test each build, and record the reason.
- **Action versions, tiered by exposure.** SHA-pin every third-party action in
  a job that reads a secret or holds an OIDC token; tag-pin is acceptable in
  jobs that see neither. Keep the human-readable version in a trailing
  comment so Dependabot can still update it. The same tiering applies to
  GitLab includes and components, Azure Pipelines template references and
  task versions, and Jenkins shared libraries and plugins.
- **Short-lived deploy credentials.** Prefer OIDC federation (GitHub to AWS
  IAM roles, Azure federated credentials, Google Workload Identity
  Federation) over stored access keys. Where a provider only offers a token
  (Netlify, Vercel, Cloudflare, the Static Web Apps deployment token), store
  it as an environment-scoped secret with required reviewers on the
  production environment if the platform supports it.
- **The manifest is the single source of truth for commands.** CI calls
  `npm run lint`, not `npx eslint .`.
- **Branch protection: apply it if you safely can, document it regardless.**
  Show the user exactly which checks you are about to require and get
  explicit confirmation before applying anything through an authenticated
  CLI. State in the final report whether it was applied or only documented.

## The deploy job, per host

Follow the matching row in `decisions.md`. Every deploy job:

1. Downloads the tested `dist/` artefact.
2. Authenticates with the shortest-lived credential the host supports.
3. Uploads with the correct cache headers (immutable for hashed assets,
   `no-cache` for `index.html`). On S3 that means two sync passes with
   different `--cache-control` values; other hosts read it from their config
   file.
4. Invalidates the CDN cache where the host needs it (CloudFront).
5. Runs a post-deploy check: `curl -sSI` the site root and one nested route,
   assert a 200 for both, and assert each required security header is
   present. Fail the job if any is missing. On a host without header or
   rewrite control, use the adjusted check in `decisions.md` instead.

At the top of the job, add a comment that says the job is blocked until the
listed resources and secrets exist, and put the same list in the README's
deploy checklist with each secret's name, its source, and who issues it.

Where the host offers preview deployments per pull request (Azure Static Web
Apps, Netlify, Vercel, Cloudflare Pages), mention it in the README as
available. Enable it only if the user wants it, since it means every pull
request is publicly reachable unless the host's access protection is turned
on.

## GitHub Actions

Suggested layout:

```
.github/
  workflows/
    ci.yml          # jobs 1 to 5, on pull request and push to main
    nightly.yml     # job 6, on a schedule and manual dispatch
    deploy.yml      # job 7, on push to main or tags, using the ci.yml artefact or rebuilding with the same steps
  dependabot.yml    # npm and github-actions ecosystems, grouped
  CODEOWNERS
```

- Use `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`.
- Upload the Playwright report with `if: ${{ !cancelled() }}` (or `always()`)
  so it is there when the tests fail.
- Use GitHub environments for the deploy job (`environment: production`), so
  secrets are scoped and required reviewers can be added.
- Dependency Review Action: free on public repositories, needs GitHub Advanced
  Security on private ones. Check before promising it.
- Run Gitleaks in CI from its released binary or container image, pinned by
  version and checksum or digest, rather than through `gitleaks-action`,
  which needs a paid licence key for repositories owned by an organisation
  (confirm the current terms in its README). If the user prefers the action,
  add `GITLEAKS_LICENSE` to the secrets checklist.
- If `deploy.yml` needs the artefact from `ci.yml`, either run deploy as a
  later job in the same workflow on pushes to main, or download the artefact
  from the triggering run with the run id. The first is simpler; prefer it
  unless there is a reason not to.

## GitLab CI

A single `.gitlab-ci.yml` with stages `check`, `test`, `scan`, `build`,
`e2e`, and `deploy`. Use the official Playwright Docker image for the
end-to-end jobs (pinned to the same version as the `@playwright/test`
dependency) instead of installing browsers each time. Pass `dist/` between
stages as an artefact. Offer GitLab's own SAST, dependency, and secret
detection templates as an addition since they report to the security
dashboard; pin any included template or component used in the deploy stage to
an exact version. Use GitLab's OIDC `id_tokens` for cloud deploys.

## Azure Pipelines

An `azure-pipelines.yml` with stages mirroring the job graph. Use the
`NodeTool` (or the current equivalent) task with the version from `.nvmrc`,
`Cache` keyed on the lockfile, and `PublishPipelineArtifact` for `dist/` and
the Playwright report (with `condition: succeededOrFailed()`). For Azure
targets, use a workload identity federation service connection rather than a
secret-based one. Pin task major versions and any template repository
reference to an exact ref.

## Jenkins

A declarative `Jenkinsfile` with stages for checks, tests, scans, build,
end-to-end, and deploy. Run the end-to-end stage in the official Playwright
container image as the agent, archive the report in a `post { always { ... }
}` block, bind deploy credentials with the credentials binding plugin, set a
timeout on every stage, and pin any shared library used in the deploy stage
to an exact version. Document the agent labels in the README.

## Bitbucket Pipelines

A `bitbucket-pipelines.yml` with a `pull-requests` pipeline for jobs 1 to 5, a
`branches: main` pipeline adding job 7, and a `custom` pipeline for job 6.

- Use the official Playwright Docker image, pinned to the same version as the
  `@playwright/test` dependency, as the step image for the end-to-end steps,
  and a `node` image pinned to the `.nvmrc` major for the rest.
- Pipes are Docker images. Pin any pipe used in the deploy step by image
  digest, not by tag; that is this platform's form of SHA pinning.
- Pass `dist/` between steps with `artifacts`. Use deployment environments
  for the deploy step, so its variables are scoped and secured.
- Use Bitbucket's OIDC (`oidc: true` on the step) for AWS, Azure, or Google
  Cloud deploys, rather than stored keys.
- Scheduled pipelines are created in the repository settings, not in the
  YAML. So job 6 is a `custom` pipeline in the file, and the README deploy
  checklist includes "create a nightly schedule for the `nightly` custom
  pipeline" as a manual step, with the report saying it is not yet active.
- There is no local validator equivalent to `actionlint`; Bitbucket's
  validator is a web page. Parse the YAML locally, check every script it
  calls exists, and say plainly in the report that the stronger validation
  was not run.
- There is no built-in Dependabot. Recommend Renovate (it needs its hosted
  app or a runner), commit its config, and say it is inactive until set up.
- Merge checks that block a merge on a failing build need a paid plan. Say so
  next to the branch protection requirement in the README.

## CircleCI

A `.circleci/config.yml` with a workflow for jobs 1 to 5 and 7, and a
scheduled trigger for job 6 (confirm whether current CircleCI expresses
schedules in the config or as project settings, and add a checklist item if
the latter). Use the Playwright image for the end-to-end jobs, pass `dist/`
with `persist_to_workspace`, use CircleCI's OIDC token for cloud deploys,
and pin any orb used in the deploy job to an exact version. Validate with
`circleci config validate` if the CLI can be installed, otherwise say so.

## Other platforms

Others support the same graph. Map the scripts to jobs, pin the runtime, use
the clean install, keep the order, and apply the same pinning and credentials
rules.

## Low-minute and free plans

Free CI tiers vary widely, and some (Bitbucket's free tier, for example, as of
the last review) have too few build minutes a month for a Playwright run on
every pull request plus a three-browser nightly suite. If the user is on such
a plan, scaffold the full graph but trigger it more cheaply, and say so in the
README and the CI ADR:

- Jobs 1 to 4 on every pull request.
- Job 5 on pull requests to the default branch only, or on a label, with
  Chromium only.
- Job 6 weekly instead of nightly, or manual.
- Cache dependencies and the Playwright browsers (or use the Playwright
  image) so each minute counts.

Estimate the monthly minutes from the first local timings, and include the
estimate in the report.

## Finishing

After writing the pipeline:

1. Validate it locally. For GitHub Actions, install and run `actionlint`; a
   valid YAML file can still reference a missing job or use a bad expression
   context. For GitLab, use the CI Lint API if a token is available, otherwise
   parse the YAML and say the stronger check was not run. Same principle for
   the others.
2. Check that every script the pipeline calls exists in the manifest.
3. Check that every secret and variable the pipeline reads is listed in the
   README checklist, and that none has a default value in the pipeline.
4. Check that the documented required status checks match the actual job
   names.
5. Report which jobs you could not execute and which will first run when the
   repository is pushed.
