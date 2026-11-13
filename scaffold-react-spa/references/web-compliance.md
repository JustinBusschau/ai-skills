# Web compliance readiness

> Last reviewed: 2026-11-13. The regulations and requirements named below were
> correct at that time. Confirm each against current official guidance before
> relying on it, and treat legal questions as questions for the user and their
> advisers, not decisions for this skill.

None of these is checked by lint, tests, or a build, and each is cheap to
record on day one and expensive to discover just before launch. Treat this as
a documentation checklist kept up to date as the app grows, not a one-off
task.

## What to produce

`docs/compliance/web.md`, containing the sections below. For anything the app
does not yet do, write "not yet applicable" rather than leaving the section
out, so the question has a visible answer.

### Cookies and browser storage

- Every cookie, `localStorage` key, `sessionStorage` key, and IndexedDB
  database the app or any third-party script sets, with its purpose, lifetime,
  and whether it is strictly necessary.
- Whether consent is needed before anything non-essential is set. Under UK and
  EU rules (UK GDPR and PECR, the EU GDPR and ePrivacy Directive), analytics
  and advertising storage generally needs prior consent; strictly necessary
  storage (a session, a security token, a saved preference the user asked
  for) generally does not. If anything non-essential is present, record that
  a consent mechanism is required before it loads, and list choosing one as an
  open decision for the user. Do not pick a vendor.

### Third-party scripts and origins

- Every third-party origin the app loads code, styles, fonts, or images from,
  or sends data to, with the reason. This list must match the CSP's
  `script-src`, `style-src`, `font-src`, `img-src`, and `connect-src`. A
  third-party script is also a data processor; flag any that receive personal
  data.

### Personal data

- The personal data the app displays, collects, or sends, taken from the
  entity model gathered at intake, and where it goes. This is the input to a
  privacy notice and, where needed, a data protection impact assessment. Note
  that neither is produced by this skill.

### Security headers in force

- The CSP and each security header, copied from the host config, with a note
  on any deviation from the defaults in `tooling.md` and why. For GitHub Pages
  or any host without header control, record which headers cannot be set and
  the accepted risk.

### Accessibility statement

- If the app is a public sector website or app in the UK, the Public Sector
  Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations
  2018 require a published accessibility statement in a prescribed format.
  The European Accessibility Act also applies to some private sector services
  in the EU from June 2025. Record whether either applies (as a question for
  the user if the brief does not say), and if one does, note that a statement
  is needed and link to `docs/accessibility.md` for the testing that supports
  it.

## Updating it

Update this file in the same pull request that adds a cookie, a storage key, a
third-party origin, or a new kind of personal data, the same discipline the
tooling baseline asks of scripts and CI jobs. Add a line to the pull request
template, if one exists, asking whether it was needed.
