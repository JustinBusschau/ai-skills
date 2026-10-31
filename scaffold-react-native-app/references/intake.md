# Intake: turning an input into a brief

> Last reviewed: 2026-10-02. This file is a starting point, per operating
> principle 1 in `SKILL.md`, not a substitute for confirming anything
> version-specific against current docs.

The skill accepts three input shapes. This file covers how to read each one and
what to extract, so that scaffolding starts from understood requirements rather
than a guess.

## Shape one: a single line

Typical input: "a habit tracker for people who run" or "an app that helps my
team file expenses".

What you can reliably extract: the app name, one or two core features, and
sometimes a platform hint. Everything else is unknown.

What to do:

1. Choose a slug from the name (lowercase, hyphenated, no version suffix).
2. Propose the shortest plausible user flow, usually two or three screens, and
  the main entity the app manages.
3. Write a brief of about five bullets and confirm it. Offer the smallest set of
  decisions and let the user correct them.
4. Do not over-build. A single line does not license a data layer, an
  authentication system, and a design system. Scaffold the shell, one working
  flow, and the tooling that will support the rest.

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
   | Identity | Display name, slug, bundle identifier prefix |
   | Platforms | iOS only, Android only, or both, and web if the user cares |
   | Flows | The main user journeys, in order, with the entry and exit points |
   | Navigation | Tabbed, stack based, or wizard shaped |
   | State | Local only, persisted, or server synchronised |
   | Data | Backend, offline requirement, caching expectation |
   | Design | Existing tokens, brand colours, typography, platform native or custom |
   | Constraints | Compliance regime, offline requirement, accessibility target, deadline |

   If an accessibility target is stated (for example WCAG 2.2 AA), record it
   as an open obligation, not a solved one: the tooling baseline in
   `tooling.md` narrows risk but does not itself certify conformance, and the
   brief should say so explicitly rather than implying the lint rules and
   test helper are the whole answer.

3. Turn the flows into the route tree you will scaffold. If the brief has four
   flows, the scaffold needs four reachable routes, not one placeholder and a
   TODO.
4. Confirm the brief before scaffolding.

## Shape three: a repository of design and architecture documentation

This is the input that rewards careful reading. The repository may contain
design documents, architecture decision records, a style guide, an API contract,
a data model, an existing partial implementation, or a competitor analysis. It
may also contain none of these and only a directory of images.

### Discovery order

Work outwards from the most authoritative source to the least.

1. **Version control and top level.** Check whether the directory is a
   repository, and look at the top level listing. A `package.json`, an
   `android` or `ios` directory, or a `.expo` directory means this may be a
   partial implementation rather than a blank slate. Say so, and ask whether
   you are starting fresh or building on what exists. Also check for a
   `workspaces` field in `package.json`, a `turbo.json`, or an `nx.json`, or a
   lockfile that sits above the directory you were pointed at. Any of these
   means you are being asked to scaffold inside an existing monorepo, which
   this skill's defaults do not fully cover (workspace boundaries, shared
   configs, and CI scoped to a sub-path are not addressed elsewhere in this
   skill). Say so explicitly, and ask the user how they want those boundaries
   handled before proceeding, rather than applying the single-repo defaults
   unchanged. More broadly, the same caveat applies to any directory that is
   not the root of its own repository, whether or not it uses formal
   workspace tooling: if you are being asked to scaffold into a subdirectory
   of an existing repository that has no workspace signals at all (for
   example, an existing backend repository that simply wants a new `apps/`
   subfolder), say so, and ask how the sub-path, its own manifest, and CI
   scoping should relate to the surrounding repository, rather than silently
   assuming this is the only thing in it.
2. **Explicit architecture records.** Look for `docs/adr`, `docs/architecture`,
   `ARCHITECTURE.md`, `docs/design`, `README.md`, and any file with a decision
   record front matter (ADR, RFC, or "Status" and "Decision" headings). These
   are binding. An existing ADR that says "no Expo" outranks a default.
3. **Design documentation.** Look for a design system, a Figma export, style
   tokens, colour and typography definitions, and component specifications.
   Extract the design tokens, because they belong in a typed theme module from
   the first commit.
4. **Contracts.** API specifications, OpenAPI documents, data models, event
   schemas, and state machine descriptions. These determine the data layer and
   the entity types, so read them before writing any types.
5. **Product documents.** User flows, screen lists, onboarding requirements,
   analytics requirements, and accessibility or compliance commitments. A stated
   accessibility commitment (for example WCAG 2.2 AA) must be reflected in the
   lint rules and the test helpers, not just the README.
6. **Incidental sources.** Screenshots, recordings, slide decks, and PDFs. Read
   them, but treat them as intent rather than specification. Where a screenshot
   conflicts with a written document, flag the conflict rather than picking one.

### What to extract

Produce a structured summary containing:

- The proposed display name, slug, and bundle identifier prefix.
- The target platforms and the minimum supported OS versions if stated.
- The full route tree, with the user flow each route serves.
- The entity model, with field names and types, taken from the contract
  documents rather than invented.
- The design tokens, with their names and values.
- The data sources and whether offline behaviour is required.
- The compliance and accessibility requirements, stated as testable obligations
  where possible, and flagged, where the obligation is a named standard such
  as WCAG, as something the tooling baseline narrows but does not certify.
- The explicit decisions already made, with their source file.
- The open questions, and the default you will use for each if the user does
  not answer.

### Rules for reading a repository of documentation

- **Do not scaffold inside a directory that already contains a working app.**
  Ask first whether you are extending it or replacing it. Replacing a directory
  someone has been working in is destructive and must be explicit.
- **Prefer the written specification over the screenshot**, and the ADR over
  your own preference.
- **Quote the source** when you extract a decision, so the user can check your
  reading against the document.
- **Do not invent field names.** If the API contract is silent on a field, list
  it as open rather than guessing a camelCase equivalent.
- **Keep the extraction separate from the implementation.** Summarise first,
  scaffold second, so the user has one clear place to correct your reading.

## The brief

Whatever the input shape, end this step with a brief of five to ten bullets in
plain prose. It should read as a statement of what you understood and what you
are about to build, not as a form. Show it, ask for confirmation, and proceed on
a yes.
