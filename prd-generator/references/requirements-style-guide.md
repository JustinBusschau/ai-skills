# Requirements Style Guide (IEEE 29148-derived)

Read this before writing the Functional Requirements and Non-Functional Requirements sections of a PRD. It's the operational detail behind "requirements discipline": mandatory language, atomicity, explicit subjects, verifiability, and traceability.

## 1. Mandatory language

Use **shall** to state a requirement. Don't use:
- **will**: describes future fact, not an obligation
- **should**: a recommendation, not a requirement
- **may**: permission, not a requirement

| Non-compliant | Compliant |
|---|---|
| The system will log authentication attempts. | The system shall log all authentication attempts. |
| The API should validate input. | The API shall validate all input fields prior to processing. |

## 2. Atomicity: one requirement, one statement

Each requirement expresses exactly one capability, constraint, or behavior. A statement joined by "and" is usually two requirements wearing a trenchcoat.

**Non-compliant:** The system shall authenticate users and log access attempts.

**Compliant:**
1. The system shall authenticate users prior to granting access.
2. The system shall log all authentication attempts.

Splitting requirements this way isn't pedantry: it's what makes each one independently traceable and independently testable. A single combined statement can pass a demo while one half of it silently fails in production.

## 3. Explicit subject

Every requirement names who or what performs the action. Preferred subjects: *the system*, *the application*, *the service*, *the API*, *the database* (or a more specific named component). Avoid passive voice, which hides the subject.

**Non-compliant:** Passwords shall be encrypted before storage. *(encrypted by what?)*

**Compliant:** The system shall encrypt all user passwords before storage.

## 4. Verifiability: no statement you can't test

Every requirement must be checkable by inspection, analysis, demonstration, or test. Avoid subjective terms with no defined threshold: *fast, easy, user-friendly, robust, sufficient, seamless, intuitive, reasonable, appropriate.* Replace with a quantitative threshold, a measurable condition, or a reference to a named standard.

**Non-compliant:** The system shall respond quickly.

**Compliant:** The system shall respond to API requests within 500 ms for 95% of requests under nominal load.

This applies to Goals & Success Metrics too, even though those aren't formal shall-statements: "improve onboarding" isn't a goal you can know you've hit; "increase 7-day activation rate from 40% to 55%" is.

## 5. Conditions and constraints stated explicitly

If a requirement only applies under certain conditions, say so as part of the statement rather than leaving it implied.

**Example:** When operating in offline mode, the application shall queue outbound transactions and transmit them within 30 seconds of network restoration.

## 6. Recommended sentence structure

```
[Optional Condition] + [Subject] + shall + [Action] + [Object] + [Optional Constraint]
```

**Example:** When a user account is locked, the system shall reject all authentication attempts.

## 7. Avoid design bias

State *what* the system must do, not *how* it's implemented, unless the implementation is actually mandated (e.g., by contract, regulation, or an existing architectural constraint the user has confirmed).

**Non-compliant:** The system shall use PostgreSQL for data storage.

**Compliant:** The system shall persist transactional data in a relational database.

If the user's source material specifies a real, confirmed technical constraint (e.g., "must integrate with our existing Postgres instance"), that's legitimate: capture it as a constraint in Assumptions & Constraints, or as a requirement only if it's truly contractual, rather than defaulting to whatever technology came to mind first.

## 8. Unique identifiers

Every requirement gets a unique ID for traceability: `REQ-<CATEGORY>-<NUMBER>`, e.g. `REQ-SEC-001`. Infer the category from the requirement's subject matter: common categories include AUTH, PERF, SEC, DATA, UI, API, REL (reliability), COMP (compliance), GEN (general, when nothing more specific fits). Number sequentially within each category, don't reuse numbers, and don't renumber existing IDs if you're revising an existing PRD: that breaks traceability for anyone who already referenced the old ID.

## 9. Functional vs. non-functional

- **Functional requirements** describe what the system does: `REQ-AUTH-004: The system shall lock a user account after five consecutive failed login attempts within ten minutes.`
- **Non-functional requirements** describe constraints on how well it does it: performance, security, reliability, scalability, compliance. `REQ-PERF-002: The system shall support 1,000 concurrent users while maintaining an average response time of 500 ms or less.`

Keep them in separate sections: mixing them makes it harder for reviewers to check the right kind of thing (a functional requirement needs a demo; a performance requirement needs a load test).

## 10. Consistency and terminology

Use one term per concept throughout the whole document. If the source material calls the same thing "user," "customer," and "account holder" interchangeably, pick one, use it everywhere, and define it once in the Glossary. Terminology drift is a common way that a document *reads* as complete while actually being ambiguous about who does what.

## Quick self-check (apply to every requirement before finalizing)

- [ ] Uses "shall"
- [ ] Has a clear, explicit subject
- [ ] Is atomic (one capability per statement)
- [ ] Is unambiguous (only one possible interpretation)
- [ ] Is verifiable (a test or inspection could prove compliance)
- [ ] Avoids subjective/undefined language
- [ ] Has a unique ID
- [ ] Uses terms consistent with the Glossary
- [ ] Reads as a natural, complete sentence, not a clipped fragment or keyword list
- [ ] Contains no em dash or en dash anywhere (use a standard hyphen, comma, colon, or a new sentence instead)
