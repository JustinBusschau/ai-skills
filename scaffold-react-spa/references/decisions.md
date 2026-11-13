# The four decisions and their enforcement

> Last reviewed: 2026-11-13. The package names, config file names, plugin
> names, and provider behaviour below were correct at that time. Confirm each
> one against the official docs or `--help` before relying on it; this file is
> a starting point, per operating principle 1 in `SKILL.md`, not a substitute
> for checking.

This file covers what each answer to the mandatory questions means, how to
scaffold it, and the sweep that proves the answers are enforced consistently
across the repository.

## Asking

Ask all four in one call to the question tool. Suggested framing:

- **Hosting:** "Where will the built app be served from? This decides the
  deep-link fallback, where the security headers and Content Security Policy
  live, and the deploy job." Offer the targets in the table below that fit
  the brief, with the one the brief or an ADR implies as recommended. With no
  signal at all, recommend the static host that matches the CI platform (Azure
  Static Web Apps with Azure Pipelines, for example) or, failing that, say the
  choice is open and recommend the one with the least infrastructure to
  create (Netlify or Cloudflare Pages).
- **Router:** "React Router (recommended, the most widely used, data router
  with loaders and actions) or TanStack Router (fully typed routes and search
  parameters, file-based routing through a Vite plugin)?"
- **Server state:** "TanStack Query (recommended for any app that calls an
  API: caching, retries, request de-duplication, and background refresh), or
  no server-state library (a small typed fetch client; right for an app with
  no backend or only one or two calls)?" If the user picks something else
  through the free-text option (SWR, RTK Query, Apollo for a GraphQL backend),
  accept it, confirm its current docs, and apply the same enforcement rules.
- **CI platform:** as in `SKILL.md`.

Record each answer and its reason in its own ADR.

## Decision 1: hosting target

### Why it is mandatory

An SPA serves one `index.html` for every route and lets the router take over
in the browser. Every host needs to be told to do that (the "history
fallback"), or a refresh on `/settings/profile` returns a 404. The same host is
also the only place real HTTP security headers can be set: a `<meta>` tag can
carry a CSP but cannot carry `frame-ancestors`, HSTS, or most other headers.
So the host choice determines files in the repository, not only a deploy
step.

### Per-host consequences

Confirm the exact file name, schema, and field names in each provider's
current documentation before writing the file.

| Host | History fallback | Headers and CSP | Base path | Deploy from CI | Preview deployments |
| --- | --- | --- | --- | --- | --- |
| AWS S3 plus CloudFront | A CloudFront Function on viewer request that rewrites extension-less paths to `/index.html` (preferred), or custom error responses mapping 403 and 404 to `/index.html` with 200 (simpler, but it also masks genuine missing assets) | A CloudFront response headers policy, defined in infrastructure as code if the brief has any, otherwise documented as a manual step | Root, unless the distribution serves a sub-path | `aws s3 sync` of `dist/` plus a CloudFront invalidation, with credentials from OIDC role assumption, never long-lived keys | Not built in; document as out of scope |
| Azure Static Web Apps | `navigationFallback` in `staticwebapp.config.json`, with an `exclude` list for asset paths | `globalHeaders` in the same file | Root | The official deploy action or task, with the deployment token as a secret, or OIDC where supported | Built in per pull request |
| Netlify | A `/* /index.html 200` rule in `netlify.toml` (or `_redirects` in `public/`) | `[[headers]]` in `netlify.toml` | Root | Netlify CLI with an auth token and site id as secrets, or the Netlify Git integration (then CI does not deploy) | Built in |
| Vercel | A rewrite of all paths to `/index.html` in `vercel.json` | `headers` in `vercel.json` | Root | Vercel CLI with a token, org id, and project id as secrets, or the Git integration | Built in |
| Cloudflare Pages | Automatic SPA fallback when there is no top-level `404.html` (confirm current behaviour) | A `_headers` file in `public/` | Root | Wrangler with an API token and account id as secrets | Built in |
| GitHub Pages | No server rewrite support. Either copy `index.html` to `404.html` at build time (the response status is then 404, which crawlers and some monitoring see) or use hash routing; record which and why. See "Hosts without header or rewrite control" below | No header control at all; see below | Usually `/<repo>/`, so Vite `base` and the router basename must match | With GitHub Actions: the official Pages deploy actions, with `pages: write` and `id-token: write` on that job only. With any other CI: see below | No |
| Container with nginx (or another web server) | `try_files $uri /index.html;` with assets excluded from the fallback | `add_header` directives, with `always`, in the server config committed to the repo | Configurable | Build and push an image; the deployment target (Kubernetes, App Service, ECS) is an open question to ask about, not to guess | Depends on platform |
| Other or existing infrastructure | Ask the user how the fallback and headers are configured, write it down, and add the closest equivalent above | As left | As left | As left | As left |

For every host that allows it (see the next section for those that do not):

- **Cache rules.** Hashed files under `dist/assets/` are served with a long,
  immutable cache lifetime. `index.html` is served with `no-cache` (revalidate
  every time), otherwise users keep loading an old shell that points at deleted
  asset files after a deploy.
- **Missing assets are not rewritten.** A request for a missing
  `/assets/*.js` must return a 404, not `index.html`, or a stale tab fails with
  a confusing MIME type error instead of a clear one. Exclude asset paths from
  the fallback wherever the host allows it.
- **Base path consistency.** If the app is served under a sub-path, Vite's
  `base`, the router's `basename`, and any absolute asset URLs must all agree.
  Add an end-to-end test that loads a nested route under that base.
- **Security headers.** At minimum: `Content-Security-Policy`,
  `Strict-Transport-Security` (on hosts you control the domain for),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy` limited to what the app uses, and `frame-ancestors`
  in the CSP (preferred over `X-Frame-Options`). `tooling.md` covers the CSP
  itself.

### Hosts without header or rewrite control

GitHub Pages is the common case; some intranet file servers and object stores
without a CDN are similar. On these hosts several rules in this skill cannot be
met as written. Replace them as follows, and record every replacement in the
hosting ADR and `docs/compliance/web.md` as an accepted limitation, so nobody
mistakes its absence for an oversight.

- **Fallback.** Generate `404.html` as a byte-for-byte copy of `index.html`
  in the build (a small Vite plugin or a post-build script), and test it: a
  unit or post-build check that `dist/404.html` exists and matches
  `dist/index.html`. Nested deep links then return the app with a 404 status;
  the end-to-end deep link test still passes, and the post-deploy check
  expects a 404 status with the app shell for nested routes rather than a
  200. With hash routing instead, there is no fallback to test, and the deep
  link tests use `/#/` URLs.
- **CSP.** Only a `<meta http-equiv="Content-Security-Policy">` tag is
  possible. Inject it at build time only (a Vite plugin using
  `transformIndexHtml` with `apply: 'build'`), never in the source
  `index.html`, because the React plugin's development preamble is an inline
  script that `script-src 'self'` would block in `npm run dev`. Leave out
  `frame-ancestors`, `report-uri`, `report-to`, and `sandbox`, which browsers
  ignore in a meta tag and warn about in the console (and the end-to-end
  suite fails on CSP console messages). Configure `vite preview` with the
  same policy as a header, minus those directives, so the suite runs under
  it.
- **Other headers.** HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, and clickjacking protection cannot be set. A
  `<meta name="referrer">` tag covers the referrer policy. Record the rest as
  accepted risk; if the app handles personal data or sits behind sign-in,
  recommend a host that can set headers instead, in the question.
- **Cache rules.** The host sets a fixed cache lifetime that applies to
  `index.html` as well. Say so in the README: after a deploy, users may load
  the old shell for a few minutes.
- **Host config tests.** There is no host config file to parse, so replace
  that unit test with the `404.html` check and a check that the built
  `index.html` contains the meta CSP with no `unsafe-` keyword in
  `script-src`.
- **Post-deploy check.** Assert a 200 for the root, the expected status and
  app shell for a nested route, and the meta CSP in the served HTML. Do not
  assert response headers the host cannot send.

**GitHub Pages from a CI platform other than GitHub Actions.** The Pages
deploy actions, and the short-lived token they use, exist only in GitHub
Actions. The pragmatic option is a minimal GitHub Actions workflow in a GitHub
mirror that deploys only, while the main CI stays where the user wants it.
The alternative is pushing `dist/` to a `gh-pages` branch from the other CI
system, which needs a long-lived credential with write access to the GitHub
repository. If the user chooses that, use a fine-grained personal access token
(or a deploy key) scoped to that one repository with contents write only,
store it as a secured variable, and add `.nojekyll` to the published output so
that Jekyll does not drop files whose names start with an underscore. Put the
trade-off in the hosting question, not only in the ADR, and remember that this
route also needs a GitHub repository in addition to the user's main one.

### Release credentials

None of these hosts can be deployed to without resources and credentials this
skill cannot create: a bucket and distribution, a Static Web App resource, a
Netlify or Vercel project, a Cloudflare account, or a registry and cluster.
Scaffold the deploy job regardless (see `ci.md`), mark it blocked, and list in
the README exactly which resource to create and which secret or variable the
job reads. Do not create cloud resources through an authenticated CLI on the
user's behalf without showing exactly what will be created and getting
confirmation.

## Decision 2: router

### React Router

Use React Router as a library with a data router (`createBrowserRouter`, or
`createHashRouter` only if the host forces hash routing), not its framework
mode. Framework mode can be configured as an SPA, but it replaces Vite's own
entry point and build conventions, which changes most of the rest of this
skill; if the user explicitly wants it, record that in the ADR and confirm the
`ssr: false` SPA mode in the current docs before going on.

Confirm the current package name before installing (in recent majors it is
`react-router`, with `react-router-dom` reduced to a re-export).

Scaffold:

- A route module (for example `src/routes.tsx`) with a root layout route, one
  route per main flow, an `errorElement` on the root (and on any route whose
  loader can fail), and a catch-all not-found route.
- Lazy-loaded route modules for anything beyond the first screen, using the
  router's own `lazy` support, so the initial bundle stays inside the size
  budget.
- Loaders for route data where the server-state decision allows it (see
  decision 3 for how the two interact).
- A test helper that renders a route tree in a memory router, so component
  tests can render a page at a given URL.

Must not appear: `react-router-dom` and `react-router` at different majors, a
second router, `window.location` assignments for in-app navigation, or a
`<BrowserRouter>` wrapper alongside a data router.

### TanStack Router

Use the TanStack Router Vite plugin with file-based routing, and confirm the
current plugin package and its option names in the docs. The plugin generates
a route tree file (for example `src/routeTree.gen.ts`); decide in the ADR
whether that file is committed (simpler for CI and type checking, the usual
recommendation) or generated before every type check, and enforce whichever
you chose. Exclude it from lint and formatting either way.

Scaffold:

- A root route with the layout, a `notFoundComponent`, and an
  `errorComponent`.
- One route file per main flow, with search parameter schemas validated
  (with the validator the TanStack docs currently recommend) for any route
  that has filters or pagination.
- The router's type registration (the module declaration that makes `Link`
  and `navigate` fully typed), so a broken link is a type error.
- Automatic code splitting through the plugin option, confirmed in the docs.
- A test helper that creates a router with a memory history for component
  tests.

Must not appear: React Router packages, hand written route trees alongside the
generated one, untyped string navigation that bypasses the registered types,
or the devtools in the production bundle (lazy-load them behind a development
check).

## Decision 3: server-state library

### TanStack Query

- One `QueryClient`, created in one module, with defaults chosen deliberately
  and written down: a non-zero `staleTime` appropriate to the data, retry
  disabled in tests, and `refetchOnWindowFocus` left on unless the brief says
  otherwise.
- Query keys built through a small key factory per entity, so invalidation is
  not a string-matching exercise.
- A typed API client that every query and mutation function goes through,
  which owns the base URL (from the typed env module), authentication headers,
  and error normalisation. Queries do not call `fetch` directly.
- With React Router, either fetch in components with `useQuery` or prefetch in
  loaders with `queryClient.ensureQueryData`; pick one pattern and write it in
  `AGENTS.md`. With TanStack Router, use route loaders with
  `ensureQueryData` and pass the client through router context, as the
  TanStack docs describe.
- A test helper that wraps a component in a fresh `QueryClient` per test, so
  cached data cannot leak between tests.
- The devtools only in development, lazy-loaded.

Must not appear: a second cache (a context or store holding copies of server
data), direct `fetch` calls in components, or a shared `QueryClient` across
tests.

### None (a small typed fetch client)

- A single typed API client module, as above, which every call goes through.
- Data fetched in route loaders where the router supports them, so loading and
  error states are handled by the router's own pending and error UI rather
  than by ad hoc `useEffect` fetching.
- No `useEffect`-plus-`useState` fetching in components for anything the
  router can load. Where component-level fetching is genuinely needed, handle
  cancellation (an `AbortController`) and the race between overlapping
  requests, and say in the ADR that if more than a handful of these appear the
  decision should be revisited.

Must not appear: a hand rolled caching layer, retry logic, or request
de-duplication. If the app needs those, the right answer is to revisit the
decision, not to reimplement a library.

### Mocking the API in both cases

Use Mock Service Worker for both unit tests (its Node integration) and, where
the brief has no running backend yet, local development (its browser
integration, started only in development mode). Handlers live in one place
and use the entity types, so a contract change breaks the mocks at compile
time. If the user already has an API mock server, point the development proxy
at it instead and keep MSW for unit tests only.

## The enforcement sweep

Run this immediately after scaffolding and before adding the tooling, and
again at the end of verification. Work through every row and correct each
surface that contradicts the decisions.

| Check | How to verify |
| --- | --- |
| Exactly one router package family is present | Read `package.json` and the lockfile; search the source for imports from the other router. |
| The server-state choice is the only caching layer | Search for a second `QueryClient`, for `fetch(` outside the API client module, and for context providers holding API data. |
| Exactly one host's configuration exists | Look for `staticwebapp.config.json`, `netlify.toml`, `_redirects`, `vercel.json`, `_headers`, nginx config, and CloudFront definitions; only the chosen host's may exist. |
| The fallback is configured and excludes assets | Read the host config. |
| Headers and CSP are configured at the host (or, for GitHub Pages, the limitation is recorded) | Read the host config and the ADR. |
| Vite `base`, the router basename, and the host path agree | Read all three. |
| `VITE_` variables are read only in the typed env module | Search for `import.meta.env.VITE_` and dynamic `import.meta.env[` outside that module (the in-repo check should also catch this). Literal `DEV`, `PROD`, and `MODE` checks elsewhere are expected. |
| No `VITE_` variable name suggests a secret | Read `.env.example` and the env module for names containing `SECRET`, `PRIVATE`, `PASSWORD`, or `KEY` that is not explicitly a publishable key, and challenge each one. |
| Every script in the manifest belongs to the chosen setup | Read `package.json` end to end. |
| Every CI job belongs to the chosen setup | Read the pipeline file, especially the deploy job. |
| The documentation agrees | The README, `AGENTS.md`, and the ADRs state the same four choices. |

Record the sweep result in the hosting ADR, since a reviewer will want to see
that the decisions were verified rather than assumed.
