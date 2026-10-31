# Mobile API design principles

Apply these while drafting each endpoint, not as review comments afterwards.

**Contract-first.** Specify and mock before the client team builds against it - nobody should be blocked on a backend that doesn't exist yet.

**Standard error envelope.** One shape for every non-2xx response: a code (enum, machine-switchable), a human message, a `retryable` flag, a correlation ID, and an optional field-name for validation errors. Every endpoint uses it - don't let individual endpoints invent their own error shape.

**Pagination envelope.** One shape for every list response (`data` + a pagination object). Same reasoning as the error envelope.

**Idempotency keys on writes with real cost.** Not a blanket "every POST" rule - target writes where a retried duplicate has a real consequence (payments, uploads, anything that provisions a resource). A client retrying after a dropped response must not double-charge or double-create.

**Secure session endpoints against abuse.** Where the API owns session lifecycle (login, refresh, revoke), those endpoints need rate-limiting or lockout on repeated failures, enumeration-safe error responses (don't reveal whether an email/username exists), refresh-token rotation, and a stated token expiry policy. The specific thresholds and durations are a security/product decision, not something to invent here - if they're not already confirmed, name it as an open question for whoever owns auth policy, the same way an interest rate or retention period would be.

**ID bootstrapping.** The first authenticated call a client makes must return every ID that later calls will need as a path parameter. If an endpoint takes `{orderId}` in its path, trace back to where the client first learns an order's ID - if there's no answer, that's a gap, not an implementation detail to sort out later. This also applies mid-session: if an ID is assigned partway through a flow (e.g. only after some prior step completes), whatever the client already polls should surface it too, not just the initial bootstrap call.

**Preview before commit, and keep them honest.** Anything financially or legally consequential gets a preview/calculate step before the action that actually commits. The preview and the commit must take the *same request shape* and apply the *same validation* - a preview that says "this is fine" and a commit that then rejects it is a contract bug, not an edge case.

**Read/write symmetry.** Every write needs a way to view current state first (what is this changing *from*). Anything the client must validate before submitting (allowed values, formats, size limits, available options) comes from a config/rules endpoint, not a hard-coded list in the client - so a rule change doesn't require a client release. Anything registered should have a way to deregister.

**Terminal states are not pipeline steps.** Model an exit (declined, cancelled, failed, withdrawn) as a distinct terminal state, not squeezed into a breadcrumb of forward-only progress stages. A UI rendering a linear progress trail needs to know which states are "further along" and which are "this exited."

**Explicit consent for consequential actions.** Anything requiring the customer's formal agreement (accepting terms, confirming a charge) gets an explicit accept/decline endpoint, not an implicit side-effect of viewing something. For genuinely high-stakes confirmations (money, legal terms), have the client echo back the specific figures/terms it saw, and reject if they've since changed - this catches a stale cached view before it causes real harm, not just a hypothetical one.

**Cross-reference, don't duplicate.** When two payloads need to represent the same relationship, link by ID with a named field, rather than repeating the same data in both places. Duplicated data drifts; one of the two copies will eventually be stale.

**Machine-actionable over free text.** If a response is meant to drive client navigation or logic, give it a typed field the client can switch on. A `description` string the client has to parse to decide what screen to show is a design smell.

**Async by default when uncertain.** If an operation *might* take time (generation, a third-party call, a calculation), default to request-then-poll rather than assuming synchronous. A poll-based contract degrades gracefully to "instant" if the operation turns out to be fast; a synchronous-only contract breaks if it turns out to be slow.

**Compliance defaults, stated even if not asked for.** If the app supports account creation, it needs an account-deletion path - both app stores require this (confirm the current clause number in Apple's and Google's published developer policies rather than citing one from memory, since store policy numbering is revised over time). Flag this even unprompted. Keep it scoped to the app-level account/identity; never conflate it with a domain-specific action like closing a loan, cancelling a subscription, or deleting a business record. This is separate from GDPR/CCPA-style data-rights endpoints (export/erasure), which are jurisdiction-dependent and are a before-drafting decision (see SKILL.md), not an always-on default - don't assume a jurisdiction applies here.

**Never invent business rules.** Where a calculation, policy, or limit is unconfirmed (an interest methodology, a retention period, a validity window), say so explicitly in the notes and name who owns the answer. A plausible-looking example value is fine as an illustration; presenting it as a confirmed rule is not.
