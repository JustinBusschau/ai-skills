---
name: code-review
description: Review commits, uncommitted changes, or branches and provide structured, actionable feedback suitable for a GitHub PR comment.
---

## When to use

Use this skill whenever the user asks you to review code — whether it's a specific commit, staged/uncommitted changes, a local or remote branch, or a diff against a base branch. If the request mentions "review", "CR", "feedback", or "look at my code" and involves comparing versions of code, this skill applies.

## What to do

1. **Understand the scope** — Determine whether the request is about:
   - A specific commit (by SHA or reference)
   - Uncommitted/staged changes in the working tree
   - A branch compared to its base (e.g. `origin/develop`, `main`)
   - A raw diff provided inline

2. **Gather the diff** — Use `git diff`, `git show`, or `git log` as appropriate to obtain the exact changes. For branches, also check the merge-base to ensure the diff is accurate. Confirm the commit, branch, or PR reference actually resolved and that the resulting diff is non-empty before proceeding - a bad SHA, a typo'd branch name, or a ref diffed against itself should be surfaced to the user, not silently treated as "no changes" or quietly worked around.

3. **Understand the context** — Read surrounding code in the affected files. Understand the imports, patterns, and conventions used so feedback is idiomatic to the codebase.

4. **Structure the review** — Always include the scored metrics (out of 10) in the verbal review. Structure as follows; step 6 below is the authoritative list of what carries over into the written file.

   ### Scored metrics (always include in verbal output; see step 6 for the file)
   Rate each of the following out of 10:
   - **Effectiveness** — How well the change meets its stated objective.
   - **Simplicity** — How straightforward the implementation is.
   - **Elegance** — How clean and idiomatic the solution feels.
   - **Design** — How well the change separates concerns and fits the existing architecture.
   - **SOLID** — Adherence to SOLID principles (single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion).
   - **Security** — Whether the change introduces any data flow, input, or access-control concerns. If the concern is a leaked credential or secret, flag its location without reproducing its actual value.

   ### Prose review (always included in verbal output; see step 6 for the file)
   - **Summary** — Explain in concise terms what the change is trying to achieve and why (the problem being solved).
   - **Strengths** — Call out what the author did well (correct approach, good edge-case handling, clean tests, etc.).
   - **Feedback** — Specific, actionable points organized by theme. Each point should identify the exact location (file + line number), explain the concern, and suggest a fix or alternative. Group related concerns together. If a point concerns a leaked credential or secret, point at its location and recommend rotation without reproducing its actual value.
   - **Side-effects / gotchas** — Whether any changes might cause unintended side-effects, or if there are gotchas in either the existing code or the changes. Be specific about race conditions, merge conflicts, edge cases, or regressions.
   - **Merge considerations** — Note if there are ordering dependencies with other branches/PRs, potential merge conflicts, or deployment concerns.

5. **Tone** — Be direct, specific, and constructive. Avoid generic praise or vague criticism. Don't add emoji. Write as if the review will be posted on a GitHub PR.

6. **Output to file (for GitHub)** — If the user asks for a review to paste into GitHub, or if the review is meant for another contributor:
   - Ask for the PR number if the user has not already provided one.
   - Before writing, check whether `{PR_num}.md` already exists in the working directory. If it does, don't silently overwrite it - ask whether to overwrite, or save under a distinguishing name (e.g. `{PR_num}-v2.md`) so the previous version is preserved.
   - Create the file. It is for a human contributor who already knows what the PR does, so omit the Summary and the scored metrics entirely. It contains exactly: **Strengths**, **Feedback**, **Side-effects / gotchas**, and **Merge considerations** - the full prose review minus the Summary.
   - Keep feedback concise. The only place verbosity is warranted is when the feedback is **negative** — in those cases, explain the reasoning so the author understands why a change is required.
   - Tell the user the file was written and that it is ready to paste into GitHub.

7. **Language and style** — Always use standard British English. Avoid em dashes and en dashes entirely (use commas or parentheses instead). Always use the Oxford comma in lists to avoid ambiguity. Write in clear, direct prose suitable for a human contributor to read and act on.

8. **Test and lint** — If the user also asks you to verify the code, run the project's test and lint commands and report findings. Otherwise, focus purely on the code review.
