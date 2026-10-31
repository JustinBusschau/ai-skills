---
name: api-contract-to-openapi
description: Generates or re-syncs an OpenAPI 3.x YAML specification from an existing Markdown API contract document, preserving its endpoints, schemas, and business rules as OpenAPI paths and components. Use when asked to create an OpenAPI or Swagger spec from a written API contract, or to keep a YAML spec in sync after the Markdown contract changes. Often invoked directly, or handed off to from the api-contract-writer skill once a Markdown contract is ready.
---

# API Contract → OpenAPI

## What this does

Translates a completed Markdown API contract (operation tables plus JSON example request/responses) into a single OpenAPI 3.x YAML file: paths, request/response schemas as reusable components, shared error/pagination envelopes, and a security scheme matching the stated auth model.

## Workflow

### 1. Locate the source

If it's not obvious which Markdown file is the source contract, ask rather than guess. If this might be a re-sync, also locate the existing YAML file - its presence is what determines that, not an assumption going in.

### 2. If this is a re-sync, decide what to preserve before regenerating

Before overwriting an existing YAML file, check its state first (e.g. `git status`/`git diff` on that file). An uncommitted hand edit is work in progress, not noise to discard - if it has uncommitted changes the Markdown change doesn't explain, surface that to the user before overwriting rather than silently replacing it.

Then identify what in the existing file has no equivalent in the Markdown contract - a `servers:` block, OAuth `authorizationUrl`/`tokenUrl` pairs, vendor `x-` extensions - and carry those forward from the existing file rather than rebuilding them from scratch, since there's nothing in the Markdown to rebuild them from. Regenerate everything that does come from the Markdown (paths, schemas, tags) as normal. `info.version` is the one exception to "carry forward" - see step 10, which always asks rather than reusing the old value.

### 3. Read it in full before writing anything

A partial read produces a spec with holes that look plausible but are wrong - a schema derived from three example fields when the doc actually specifies eight is worse than no schema, because it looks complete.

This read is also where you catch a structurally broken source: a table row linking to a schema section that doesn't exist, or an enum described one way in prose and differently in the table. This skill is often invoked standalone, not only after api-contract-writer's own completeness pass, so the source isn't guaranteed to be free of these. Don't silently invent a plausible fix or silently drop the broken reference - stop and ask, the same as when a customer-journey step is undocumented.

### 4. Choose 3.0 vs. 3.1

Default to **OpenAPI 3.0.3** for broad tool compatibility, unless the user specifically wants 3.1 or needs its native `webhooks:` support. If the contract includes inbound webhooks/events from third parties, represent them as regular paths under a clearly-named tag (e.g. "Webhooks (inbound, informational)") with a description stating they're not part of the app-facing surface - this is the standard workaround under 3.0.

Tool support for 3.1 improves over time; treat "3.0.3 for broad compatibility" as today's call, not a permanent one - if you're not confident it still holds, say so rather than asserting it.

### 5. Map structure

- Each numbered/named section of the contract → an OpenAPI tag.
- Each table row (method + path) → a path + operation, with a stable `operationId`.
- Each request/response JSON example → the operation's requestBody/responses, with the underlying object promoted to a named `components/schemas` entry rather than inlined, so it can be `$ref`'d from anywhere else it's reused (e.g. a shared error envelope, a type reused across two endpoints).

### 6. Derive schema types from examples, constraints from prose

Infer JSON types from example values, but enums, required-ness, nullability, and field descriptions come from the accompanying prose notes - the example alone under-specifies the schema. Where the Markdown doc states something is a placeholder or open question, carry that into the schema's `description`, don't silently resolve it.

Before carrying an example value into the spec, check whether it looks like a live credential or real personal data (a JWT-shaped string, a plausible real API key, a real-looking name/email/phone) rather than an obviously illustrative placeholder. Flag it to the user instead of reproducing it verbatim - generated specs are often rendered directly in tools like Swagger UI, which makes a copied secret more visible and more shareable, not less.

### 7. Reuse via $ref, don't duplicate

One `components/schemas` entry per reusable shape (error envelope, pagination envelope, any object referenced from more than one place). Reference it everywhere it's used.

### 8. Apply the auth model

Global `security` requirement matching the contract's stated auth model. Mark any endpoint the contract explicitly says doesn't need it (e.g. an unauthenticated health/status/pre-login endpoint) with `security: []` on that operation specifically - don't apply it silently to everything.

### 9. Fidelity, not extension

Keep field names, enum values, and casing **exactly** as written in the Markdown - this file mirrors the source of truth, it doesn't independently improve on it. Don't add fields, endpoints, or validation the Markdown doesn't have, even if it would be good practice. If the source is ambiguous, mirror the ambiguity (e.g. a nullable field with a description quoting the open question) rather than resolving it yourself.

This applies to everything the Markdown actually specifies. The metadata in the next step has no Markdown source, so there's nothing to mirror - handle it separately rather than guessing in the spirit of this step.

### 10. Generate the metadata the Markdown doesn't specify

`info.title`, `info.version`, and `servers:` have no Markdown source, so fidelity doesn't apply to them - they have to come from somewhere else, and that somewhere shouldn't be a silent guess presented as if it were derived from the contract.

- **info.title** - take it from the contract's own title/Purpose section.
- **info.version** - ask the user what version this is, on first generation and again on every re-sync (a re-sync's version bump depends on whether the change is breaking, which only the user can judge). Don't auto-increment.
- **servers:** - if the contract doesn't state real base URLs, state a placeholder (e.g. `https://api.example.com`) and mark it clearly, in a sibling `description` or comment, as not yet confirmed rather than leaving it looking like a real target.

### 11. Header comment

At the top of the generated file, note: which Markdown file it was generated from, that it must be kept in sync manually, and that the Markdown doc is authoritative on any conflict.

### 12. Validate before finishing

Parse the YAML, confirm every `$ref` resolves, confirm no duplicate `operationId`s, and run a proper OpenAPI structural validator if one is available in the environment (e.g. `openapi-spec-validator` for Python) rather than relying on `$ref`-resolution alone - that catches shape mistakes a resolution check won't.

### 13. Report what changed

If this is a re-sync of an existing YAML file rather than a first generation, summarise what changed (new/removed operations, changed schemas, anything preserved from step 2) - not just "done."
