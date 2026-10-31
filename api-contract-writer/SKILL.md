---
name: api-contract-writer
description: Drafts a complete, internally consistent API contract document (Markdown) for a mobile app backend, at the same rigor as a contract that's been through a full review cycle. Before drafting, asks whether status updates should be polled or event-driven, whether authentication/session is owned by the API itself or delegated entirely to a third-party identity provider (Entra ID, Auth0, Cognito, Firebase Auth, etc.), and whether the app needs GDPR/CCPA-style data-rights endpoints (export/erasure) distinct from account deletion - then designs every endpoint consistently with those answers. Runs a completeness pass modelled on real review gaps (missing reads for writes, missing ID bootstrapping, missing preview-before-commit, orphaned schemas, inconsistent terminal states) before finishing, and can hand off to api-contract-to-openapi for a matching OpenAPI spec. Use when asked to write, draft, or design an API contract, API spec, or backend API for a mobile app, or to review/tighten an existing one for completeness and consistency.
---

# API Contract Writer

## Why this skill exists

A first-pass API contract reads fine and is quietly full of holes: a write endpoint with no matching read, an ID referenced in a path that nothing ever issues, a "preview" that validates differently to the "commit" it's supposed to preview, a document type nobody can ever view. These don't surface until someone reads the contract line by line and asks "wait, how does the app know that?" - usually mid-build, which is the expensive time to find out.

This skill front-loads that review. The checklist in `references/completeness-checklist.md` is drawn from a real 33-item feedback round on a production mortgage-app contract; most of the gaps it lists were things that looked fine until someone asked the obvious next question.

## Before drafting: four decisions

Ask all four via AskUserQuestion before writing anything. The first three shape the Guiding Principles section and recur through every endpoint, so getting them late means rework; the fourth determines whether a matching OpenAPI spec gets produced once the Markdown contract is complete.

When the task is to review or tighten an *existing* contract rather than draft a new one, ask all four again explicitly, even if the document already states answers. This catches drift between what the contract claims and what it actually does, and confirms nothing was decided for the user silently in an earlier pass.

### 1. Polling or events?

- **Poll only** - simplest, no push infrastructure required. The client fetches status on foreground/interval. Right default when push infrastructure doesn't already exist or isn't justified yet.
- **Event-driven** - near-real-time via push notifications or webhooks. Needs a stated delivery mechanism (FCM/APNs, webhook receiver) and an event-type taxonomy.
- **Hybrid** - poll by default, push only for specifically time-critical things.

Whichever is chosen becomes a named Guiding Principle stated once at the top of the doc, and every status-bearing endpoint states which applies. If poll-only is chosen, still note in the doc which events were *considered and explicitly deferred* rather than silently omitted - a reviewer will ask about them otherwise, and "considered, deferred, here's why" reads very differently from "overlooked."

### 2. Who owns session and login?

- **API-owned session** - the API exchanges a third-party identity token (or credentials) for its own access/refresh token pair, and owns the session lifecycle. Needs: an exchange/login endpoint, a refresh endpoint, a logout/revoke endpoint - all three, not just login. A session that can be started but never refreshed or revoked is an incomplete contract.
- **Third-party-owned** - the client authenticates directly against the identity provider and presents *that* token as the bearer credential on every call. The API never issues its own tokens. No exchange/refresh/logout endpoints needed - document the expected token shape/claims and how the API validates them instead.

### 3. Does this app need explicit data-rights endpoints?

- **Not applicable / not confirmed** - no jurisdiction-specific data-rights obligation has been confirmed. Account deletion (see Compliance defaults in `references/design-principles.md`) still applies regardless, since that one is an app-store requirement rather than a privacy-regulation one.
- **GDPR/CCPA-style data rights needed** - add explicit data-export and erasure-request endpoints, distinct from and in addition to account deletion. Name who confirms which jurisdictions actually apply; don't assume one.

### 4. Is an OpenAPI YAML needed too?

If yes, once the Markdown contract is complete, invoke the `api-contract-to-openapi` skill against it (or do it inline if that skill isn't available) - don't defer this to a separate request, since the user has already told you they want it.

## Workflow

### 1. Gather context

Read whatever source material exists - user flows, a PRD, existing docs, prior notes. If the task is to review or tighten a contract that already exists, that document is source material too - read it in full here, before asking the four decisions. Don't invent a customer journey that isn't documented; if a step in the flow genuinely isn't described anywhere, ask rather than guess. Note what's confirmed versus what you're inferring.

### 2. Ask the four decisions above

Before drafting or redrafting structure or endpoints - including when reviewing an existing contract (see "Before drafting: four decisions" above for why these get re-asked rather than inferred from the existing document).

### 3. Draft the structure

When reviewing or tightening an existing contract, this step means reconciling the existing structure against the four decisions and the shape below, not rebuilding it from scratch - edit sections that are missing, inconsistent, or contradict a re-confirmed decision, and leave sections that already hold up alone. Only restructure wholesale if the user asked for that, or if a re-confirmed decision (e.g. session ownership changed) makes the existing structure wrong.

- **Purpose** - what this contract is for, who it's for, what stage it's at (first draft vs. near-final).
- **Guiding Principles** - the decisions above, plus any others load-bearing across the whole contract (gateway ownership, systems of record, cross-cutting conventions).
- **General / Cross-Cutting** - auth model, standard error envelope, pagination, idempotency keys, correlation IDs, push transport (if event-driven).
- **One section per resource/domain area** - each as an operation table (method, path, purpose, schema link) followed by full request/response schemas with illustrative JSON.

Apply `references/design-principles.md` while drafting each endpoint, not as a pass afterwards - it's cheaper to design a read/write pair together than to notice the gap later and retrofit it.

### 4. Run the completeness pass

Once a full draft exists, work through `references/completeness-checklist.md` against the whole document, not just the section you last touched - several of its checks are about consistency *between* sections (preview vs. commit validation, table description vs. actual enum, request correlator vs. event correlator).

### 5. Handle open questions honestly

Where something is genuinely unconfirmed, write the specific question and name who needs to answer it. "TBC" with no question attached is a placeholder, not a question - a reviewer can't act on it.

### 6. Cross-link

Every schema a table row claims to define should be reachable from that row. Every schema that references another (error envelope, a sibling endpoint's ID) should link to it. When you remove an endpoint or field during editing, check for and remove anything that only existed to support it - an orphaned schema with nothing pointing at it is a sign a design changed and the cleanup didn't fully happen.

### 7. Style pass on notes

See below - this is worth a dedicated pass, not just diligence while drafting.

## Note-writing style

Say the direct thing first, then justify it only if the justification isn't obvious from the words themselves. Match verbosity to genuine ambiguity, not habit - a field that's self-explanatory from its name and an example value doesn't need a sentence restating what it is.

**Don't:**
- Restate what the JSON example already shows in words.
- Hedge with "it's worth noting that" or "it should be mentioned that" - just note it.
- Write three sentences of rationale for a decision nobody's likely to question.
- Repeat the same explanation in two places when one place can be linked from the other.

**Do:**
- Lead with the fact, not the framing.
- When a decision is genuinely non-obvious, give the *reason*, once, briefly.
- When flagging an open question, name what's unconfirmed and who owns the answer.
- Prefer "X because Y" over "X. This is because Y." where both read fine - it's shorter and just as clear.

## A closing note on tone

The goal is a contract someone can build against without a follow-up meeting, not maximum possible thoroughness. Some things really are out of scope, and saying so once is enough - don't manufacture an open question for every field just to look diligent. The completeness checklist exists to catch real gaps, not to pad the document.
