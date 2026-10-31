# Completeness checklist

Run this against the whole draft once it exists, not per-section while drafting. Several items are about consistency *between* sections, which you can't catch by reviewing one section in isolation.

- [ ] **Every path-parameter ID has an issuing endpoint.** Trace each `{id}`/`{resourceId}` back to the call that first returns it to the client. If nothing does, that's a gap - not an assumed implementation detail.
- [ ] **Every consequential write has a matching read.** If a client can change something, it should be able to view the current value first, and confirm the new value after.
- [ ] **Writes with real cost carry an idempotency key.** Payments, uploads, anything that provisions a resource - a retried request after a dropped response must not double-charge or double-create.
- [ ] **Status that can go stale has a way to detect it changed.** Consistently - per the polling/events decision, not some endpoints polled and others silently assuming an event that was never actually wired up.
- [ ] **Session lifecycle is complete, if the API owns sessions.** Exchange/login, refresh, and logout/revoke all present - not just the first.
- [ ] **Session endpoints are hardened, if the API owns sessions.** Login/refresh/revoke name rate-limiting or lockout on repeated failures, enumeration-safe error responses, refresh-token rotation, and a stated token expiry policy - or flag whichever of these isn't yet confirmed as an open question, rather than leaving it unaddressed.
- [ ] **Every list response uses the shared pagination envelope.**
- [ ] **Every non-2xx response uses the shared error envelope.** Code, human message, `retryable` flag, correlation ID, optional field name - no endpoint has invented its own shape.
- [ ] **Every enum used in prose text actually appears as a documented enum somewhere, exactly once.** Not re-typed slightly differently in two different endpoints' notes.
- [ ] **No dead internal links.** Every cross-reference (schema anchor, "see above/below") resolves to something that exists.
- [ ] **No orphaned schemas.** Every schema defined is referenced by at least one table row or another schema. Leftover schemas usually mean a design changed and the old version wasn't removed.
- [ ] **Paired endpoints stay paired.** Preview vs. commit validate the same way. A request's correlator ID matches the shape of the event/webhook that completes it. A table's plain-English description of an enum matches the enum actually defined in the schema.
- [ ] **High-stakes confirmations echo back what the client saw.** Money or legal-terms confirmations have an explicit accept/decline step and make the client echo back the specific figures/terms it's confirming, rejecting if they've since changed.
- [ ] **Account deletion exists if account creation does**, and if a data-rights decision (export/erasure) was made during drafting, those endpoints exist too and are distinct from account deletion.
- [ ] **Fields meant to drive client navigation or logic are typed, not free text.** A `description` or similar string the client would have to parse to decide what screen to show is a gap, not a style choice.
- [ ] **Relationships between payloads are cross-referenced by ID, not duplicated data.** Two payloads representing the same thing should link to a single source, not repeat it.
- [ ] **Every generated/system document type is both listable and viewable**, not just referenced in passing from another endpoint's notes.
- [ ] **Money and dates use one convention, stated once.** Minor units + explicit currency for money; ISO 8601 for dates/times. Don't re-derive this per endpoint.
- [ ] **Anything client-validatable comes from a config endpoint.** Allowed values, formats, size limits - if the client needs to check something before submitting, the source of truth for that check is an API response, not a hard-coded list.
- [ ] **Terminal/exit states are flagged as such**, distinct from forward pipeline progress, with a note on how a breadcrumb-style UI should render them.
- [ ] **Every state transition has a driving mechanism.** Trace each enum-to-enum transition back to what causes it: a client-facing endpoint, an internal event, or an explicitly named off-app/back-office process (underwriting decision, legal completion, a phone call to a broker). A transition with no named cause - client-facing or off-app - is a gap, not an assumed manual step.
- [ ] **Operations that might take time default to request-then-poll, not assumed-synchronous.** Generation, a third-party call, a calculation - anything that could turn out slow degrades gracefully only if it was never modelled as instant-only.
- [ ] **Every open question is answerable.** It names the specific unknown and who's expected to resolve it - not a bare "TBC."
