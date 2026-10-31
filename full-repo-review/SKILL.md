---
name: full-repo-review
description: Review an entire repository or folder for code quality, architecture, security, and conventions, and provide structured, actionable feedback. Use when the user asks to review a whole codebase, repo, project, or folder rather than a specific branch or commit.
---

## When to use

Use this skill whenever the user asks you to review an entire repository, project, or folder. This applies when the request mentions "review my repo", "review this project", "full code review", "review the codebase", "look over this folder", or similar phrases aimed at a broad scope rather than a specific branch, commit, or diff. If the user wants a focused review of a single branch or PR, use the `code-review` skill instead.

## What to do

1. **Understand the scope** — Determine whether the request is about:
   - An entire repository (git or otherwise)
   - A specific folder or subdirectory within a project
   - A project that may or may not be under version control

2. **Survey the structure** — Begin by understanding the project layout:
   - Read the top-level directory and any README, CONTRIBUTING, or configuration files.
   - Identify the language(s), framework(s), build system, and dependency management in use.
   - Note the overall directory structure and how the project is organised (monorepo, microservices, flat, layered, etc.).
   - Check for tests, CI configuration, linting, formatting, and other quality tooling.
   - Count the source files in scope (exclude generated output, vendored/third-party code, build artefacts, and lockfiles) - this count decides how step 4 proceeds.

3. **Decide coverage before analysing** — The skill reviews "an entire repository", so default to actually reading everything; only fall back to sampling when the repo is large enough that this is impractical, and never silently.
   - **At or under ~150 source files** — read every one of them. There's no cost reason to sample at this size.
   - **Over ~150 source files** — stop and ask the user how to proceed before reading further. Explain the count and offer the choice: read everything anyway (accepting the added time/token cost), or review a prioritised, representative sample (and say which areas you'd prioritise and why). Don't pick silently - the threshold is a prompt to ask, not a trigger to auto-sample.
   - Whichever is chosen, it determines what step 4 covers, and must be stated plainly in the review's **Coverage** section (step 6) - a reader can't judge how much weight to put on the findings without knowing what was actually read.

4. **Analyse the codebase** — Read the files decided on in step 3 to assess:
   - **Code quality** — Consistency, readability, naming conventions, duplication, dead code.
   - **Architecture and design** — Separation of concerns, modularity, dependency direction, layering.
   - **SOLID principles** — Single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion.
   - **Security** — Input validation, authentication, authorisation, secrets handling, dependency vulnerabilities, data exposure. If an actual secret or credential is found, point at its location and recommend rotation without reproducing its value.
   - **Error handling** — Consistency, completeness, and appropriateness of error handling across the codebase.
   - **Testing** — Coverage, quality, test organisation, and whether tests actually verify meaningful behaviour.
   - **Dependencies** — Whether dependencies are up to date, necessary, and free of known vulnerabilities. Use the ecosystem's vulnerability tool if one is available (`npm audit`, `pip-audit`, `cargo audit`, `govulncheck`, etc.) rather than asserting a verdict from memory. If no such tool or no network access is available, say so explicitly in the review instead of stating a vulnerability-free verdict you didn't actually check.

5. **Git history (optional, requires user permission)** — If the folder is a git repository, you may suggest looking back into git history to understand when key features, patterns, or potential issues were introduced. Before doing so, always ask the user first:
   - Explain what you would like to investigate (e.g., "I would like to look at the git history to understand when the authentication module was introduced and how it evolved").
   - Wait for explicit user confirmation before running any `git log`, `git blame`, `git bisect`, or similar history commands.
   - If the user declines, proceed with the review based solely on the current state of the code.

6. **Structure the review** — Always include the scored metrics (out of 10) in the verbal review. Structure as follows; step 8 below is the authoritative list of what carries over into the written file.

   ### Scored metrics (always include in verbal output; see step 8 for the file)
   Rate each of the following out of 10:
   - **Code quality** — How clean, consistent, and readable the codebase is overall.
   - **Architecture** — How well the project is structured and how cleanly concerns are separated.
   - **SOLID** — Adherence to SOLID principles across the codebase as a whole.
   - **Security** — The overall security posture of the project.
   - **Testing** — The quality, coverage, and usefulness of the test suite.
   - **Maintainability** — How easy it would be for a new contributor to understand and modify the codebase.

   ### Prose review (always included in verbal output; see step 8 for the file)
   - **Coverage** — State plainly what was actually reviewed: every file, or which areas/directories were prioritised and which were left out, and why (e.g. over the size threshold, and what the user chose in step 3). This isn't optional padding - it's what tells the reader how much weight the rest of the review can bear.
   - **Summary** — Explain what the project is, what it does, and what technologies it uses.
   - **Strengths** — Call out what the project does well (clean architecture, good test coverage, consistent conventions, clear documentation, etc.).
   - **Feedback** — Specific, actionable points organised by theme. Each point should identify the exact location (file + line number where possible), explain the concern, and suggest a fix or alternative. Group related concerns together. Prioritise feedback by impact: critical issues first, then improvements.
   - **Security concerns** — Any security issues found, whether critical or informational. Include file paths and line numbers; if a concern is an actual discovered secret, point at the location and recommend rotation without quoting the value.
   - **Technical debt** — Accumulated shortcuts, outdated patterns, missing tests, or areas that need refactoring. Suggest a rough priority order for addressing them.
   - **Recommended next steps** — A prioritised list of the most impactful changes the team should consider.

7. **Tone** — Be direct, specific, and constructive. Avoid generic praise or vague criticism. Do not add emoji. Write as if the review will be shared with the project's maintainers.

8. **Output to file** — If the user asks for a review to save or share, or if the review is meant for a team:
   - Before writing, check whether `repo-review.md` already exists in the working directory. If it does, don't silently overwrite it - ask whether to overwrite, or save under a distinguishing name (e.g. `repo-review-YYYY-MM-DD.md`) so the previous review is preserved for comparison.
   - Create the file. It is for human contributors who know the project, so omit the scored metrics entirely. It contains exactly: **Coverage**, **Strengths**, **Feedback**, **Security concerns**, **Technical debt**, and **Recommended next steps** - the full prose review minus the Summary.
   - Keep feedback concise. The only place verbosity is warranted is when the feedback is **negative** — in those cases, explain the reasoning so the reader understands why a change is required.
   - Tell the user the file was written and where it can be found.

9. **Language and style** — Always use standard British English. Avoid em dashes and en dashes entirely (use commas or parentheses instead). Always use the Oxford comma in lists to avoid ambiguity. Write in clear, direct prose suitable for a human contributor to read and act on.

10. **Test and lint** — If the user also asks you to verify the code, run the project's test and lint commands and report findings. Otherwise, focus purely on the code review.
