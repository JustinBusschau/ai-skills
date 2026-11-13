# Intake: turning an input into a brief

> Last reviewed: 2026-11-13. This file is a starting point, per operating
> principle 1 in `SKILL.md`, not a substitute for confirming anything
> version-specific against current docs.

The skill accepts three input shapes. This file covers how to read each one and
what to extract, so that scaffolding starts from understood requirements rather
than a guess.

## First, confirm it should be an SPA

A client-rendered single page application is the right shape for an app behind
sign-in (an admin console, an internal tool, a dashboard, a customer portal),
for an app embedded in another product, and for anything where search engine
indexing and first-paint time for anonymous visitors do not matter much.

It is the wrong shape, or at least a shape to question, when the brief says
the pages must rank in search results, must be shareable with rich link
previews, or must render quickly on low-end devices for anonymous visitors (a
marketing site, a content site, a storefront). In that case say so in one or
two sentences and ask whether the user still wants an SPA. Do not switch to a
server-rendered framework on your own; that is a different skill's job.

## Shape one: a single line

Typical input: "a dashboard for our support team's ticket volumes" or "a small
app for booking meeting rooms".

What you can reliably extract: the app name, one or two core features, and
sometimes the audience. Everything else is unknown.

What to do:

1. Choose a slug from the name (lowercase, hyphenated, no version suffix).
2. Propose the shortest plausible set of routes, usually a layout plus two or
   three pages, and the main entity the app manages.
3. Write a brief of about five bullets and confirm it. Offer the smallest set
   of decisions and let the user correct them.
4. Do not over-build. A single line does not license an authentication system,
   a design system, and an internationalisation layer. Scaffold the shell,
   one working flow, and the tooling that will support the rest.

## Shape two: a paragraph or a brief

Typical input: a few paragraphs of product intent, or a ticket with acceptance
criteria.

What to do:

1. Read it twice. The second pass is where you find the constraints, which are
   usually stated in the last sentence and are the part people forget.
2. Extract into these buckets, and mark anything the input does not answer as
   an explicit open question rather than a silent default:

   | Bucket | What you need |
   | --- | --- |
   | Identity | Display name, slug, and the production domain if known |
   | Audience | Public or behind sign-in, internal or external, expected browsers and devices |
   | Flows | The main user journeys, in order, with entry and exit points |
   | Routes | The route tree, which routes need authentication, and any deep-linkable state (filters, tabs, pagination) that belongs in the URL |
   | Data | Backend API and its contract, authentication provider and flow, real-time needs, offline needs |
   | Design | Existing tokens, component library, brand colours, typography, dark mode |
   | Hosting | Any named cloud, CDN, or existing infrastructure, and whether it must sit under a sub-path |
   | Constraints | Compliance regime, accessibility target, data residency, browser support floor, deadline |

   If an accessibility target is stated (for example WCAG 2.2 AA, or the UK
   public sector accessibility regulations), record it as an open obligation,
   not a solved one: the tooling baseline narrows risk but does not certify
   conformance.

   If the app is public and in the UK or EU and the brief mentions analytics,
   advertising, or any third-party script, record that a cookie and storage
   consent mechanism is needed before those scripts run (see
   `web-compliance.md`). Do not choose a consent vendor; list it as open.

3. Turn the flows into the route tree you will scaffold.
4. Confirm the brief before scaffolding.

## Shape three: a repository of design and architecture documentation

### Discovery order

Work outwards from the most authoritative source to the least.

1. **Version control and top level.** Check whether the directory is a
   repository and look at the top-level listing. A `package.json`, a
   `vite.config.*`, an `index.html`, a `src/` directory, or a `next.config.*`
   means this may be a partial implementation (or a different framework)
   rather than a blank slate. Say so, and ask whether you are starting fresh
   or building on what exists. Check for workspace signals (a `workspaces`
   field, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, or a lockfile above
   the target directory). Any of these, or simply being asked to scaffold into
   a subdirectory of an existing repository (for example a `web/` folder next
   to a backend), means the single-repo defaults do not transfer unchanged:
   ask how the sub-path, its manifest, and CI scoping should relate to the
   surrounding repository.
2. **Explicit architecture records.** Look for `docs/adr`,
   `docs/architecture`, `ARCHITECTURE.md`, `docs/design`, `README.md`, and any
   file with decision record headings. These are binding. An existing ADR that
   names a host, a router, or a state library outranks a default, and you
   should present it as the recommended answer to the matching mandatory
   question.
3. **Design documentation.** A design system, a Figma export, style tokens,
   colour and typography definitions, and component specifications. Extract
   the tokens into a typed theme module (or CSS custom properties) from the
   first commit, and note any colour pairs that look likely to fail contrast,
   so the page-level axe checks have something to confirm.
4. **Contracts.** OpenAPI documents, GraphQL schemas, data models, and event
   schemas. These determine the data layer and the entity types. If an OpenAPI
   document exists, prefer generating types from it with a maintained
   generator over hand writing them, and add the generation as a script so the
   types cannot silently drift from the contract.
5. **Product documents.** User flows, page lists, onboarding, analytics
   requirements, and accessibility or compliance commitments.
6. **Incidental sources.** Screenshots, recordings, slide decks, and PDFs.
   Treat them as intent rather than specification. Where a screenshot
   conflicts with a written document, flag the conflict rather than picking
   one.

### What to extract

Produce a structured summary containing:

- The display name, slug, and production domain if known.
- The audience, and the browser support floor if stated.
- The full route tree, with the flow each route serves and which require
  authentication.
- The entity model, with field names and types taken from the contract
  documents rather than invented.
- The design tokens, with their names and values.
- The data sources, the authentication provider and flow, and any real-time or
  offline requirement.
- The hosting constraints.
- The compliance and accessibility requirements, as testable obligations where
  possible.
- The decisions already made, with their source file.
- The open questions, and the default you will use for each if the user does
  not answer.

### Rules for reading a repository of documentation

- **Do not scaffold inside a directory that already contains a working app.**
  Ask whether you are extending it or replacing it. Replacing is destructive
  and must be explicit.
- **Prefer the written specification over the screenshot**, and the ADR over
  your own preference.
- **Quote the source** when you extract a decision, so the user can check your
  reading.
- **Do not invent field names.** If the contract is silent on a field, list it
  as open.
- **Keep the extraction separate from the implementation.** Summarise first,
  scaffold second.

## The brief

Whatever the input shape, end this step with a brief of five to ten bullets in
plain prose. It should read as a statement of what you understood and what you
are about to build, not as a form. Show it, ask for confirmation, and proceed
on a yes. Ask for git permission in the same message (see step 4 of
`SKILL.md`). The four mandatory decisions follow in one question call of
their own, because the question tool takes at most four questions at a time.
