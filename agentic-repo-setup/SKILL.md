---
name: agentic-repo-setup
description: Prepares an existing git repository for agentic work. Checks that the folder is a git repo with a clean working tree, reviews the codebase (using the full-repo-review skill when available), confirms a one-paragraph summary of the repo's purpose with the user, then creates or updates CLAUDE.md, AGENTS.md, .claude/settings.json, and nested CLAUDE.md files so agents can understand and manage the repo correctly, and finishes by suggesting a concrete next step. Use whenever the user wants to set up, onboard, prepare, or "make agent-ready" a repo for Claude Code or other coding agents, asks for a CLAUDE.md or AGENTS.md to be written or refreshed for the whole project, or says something like "get this repo ready for Claude" or "add agent instructions to this codebase", even if they do not name the files.
---

# Agentic repo setup

This skill takes a repository someone already works in and leaves it with accurate, concise instruction files that let coding agents work in it safely. The order of the steps matters: the gates come first because every later step writes files, and the user needs to be able to see exactly what this skill changed by looking at a clean `git diff` afterwards. That is also why the skill never runs a git command that changes anything. The user stays in charge of their history.

Work through the steps in order and do not skip a confirmation point. Each one exists because a wrong guess at that point would cascade into everything after it.

## Step 1: Preflight gates (git repo, clean tree)

Run the bundled read-only script from the directory the user is working in:

```bash
bash <this-skill-dir>/scripts/preflight.sh
```

It prints the working directory, the repository top level, the `core.symlinks` setting, any agentic helper files that already exist, the `git status` output, and a final result line. Act on the result:

- **`NOT_A_GIT_REPO`**: stop. Tell the user the folder is not a git repository and that they should run `git init`, then commit the existing files (for example `git add -A && git commit -m "Initial commit"`, after checking a `.gitignore` is in place so secrets and build output are not committed), and then run this skill again. Do not run any of these yourself.
- **`NO_COMMITS`**: stop for the same reason. The repository exists but nothing is committed, so there is no baseline to diff against. Suggest the same commit steps.
- **`DIRTY`**: stop. Show the user the status lines, grouped into modified, staged, and untracked files, and suggest sensible options for each group: commit work that is ready, `git stash` (including `-u` for untracked files) work in progress, or add genuinely generated or local-only files to `.gitignore`. If something untracked looks like a secret (an `.env` file, a key, a credentials JSON), point that out and recommend ignoring it rather than committing it. Do not run any git command, and do not edit `.gitignore` yourself; these are suggestions for the user to act on.
- **`CLEAN`**: continue.

If the working directory is a subdirectory of the repository rather than the top level, mention this and ask whether the user wants the whole repository set up or only that subdirectory. Default to the top level, since that is where `CLAUDE.md` and `AGENTS.md` are read from.

Read-only git commands that inspect the current state (`git status`, `git rev-parse`, `git config --get`, `git ls-files`, `git check-ignore`) are fine throughout. History commands (`git log`, `git blame`, `git show` of older commits) are read-only too, but ask the user before running them, as `full-repo-review` requires; the current state of the code is usually enough for this skill. Never run commands that change the repository or its history, such as `add`, `commit`, `stash`, `checkout`, `reset`, `rm`, `mv`, `init`, or `config` without `--get`, even if a later step seems to call for it. Suggest them to the user instead.

## Step 2: Review the repository

If the `full-repo-review` skill is available, invoke it to review the repository. Two adjustments apply when it runs as part of this skill:

- Keep the review in the conversation rather than writing `repo-review.md`, unless the user asks for the file. Writing it would add an untracked file that the user did not ask for and would muddy the diff of this skill's changes.
- Hold the detailed findings back for Step 5. Before the summary is confirmed, the user only needs the paragraph in Step 3; a full review at this point buries the question being asked.

If `full-repo-review` is not available, survey the repository yourself: read the README and other top-level docs, the manifest and build files (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`, and so on), CI configuration, lint and format configuration, the test layout, and enough source to understand the architecture and conventions. Note any obvious problems as you go so you have something to offer in Step 5.

Either way, collect the facts the instruction files will need. Every command you record must be grounded in the repository: either defined there (a script in `package.json`, a Makefile target, a CI step) or a direct use of a tool the repository already relies on, such as running one test file with the project's own test runner. An agent that is told to run a command that does not exist wastes time and loses trust in the rest of the file.

Being defined is not the same as working, so run the test and lint commands once if they are quick and need nothing installed or started first. Do not install dependencies, start services, or run anything that writes outside build and cache folders just to check this. If a command fails, record what works instead (if you found something) and flag the failure as a finding for Step 5, rather than writing the broken command into the instruction files as if it worked. If you could not run a command, say so in the file rather than implying it was checked.

Collect:

- what the project is for and who uses it;
- languages, frameworks, package manager, and runtime versions;
- the exact commands to install, build, run, test (including a single test), lint, format, and type-check;
- the directory layout and where the main pieces of logic live;
- conventions that are not obvious from the code (naming, error handling, commit style, branching);
- gotchas: generated files that must not be edited, required environment variables (names only, never values), services the tests need, slow or flaky areas;
- whether it is a monorepo or contains sub-projects with their own tooling.

## Step 3: Confirm the summary

Give the user one short paragraph, three to five sentences, describing what the repository is for, what it is built with, and how it is organised. Ask them plainly whether it is true and accurate, and invite corrections.

Wait for their answer. If they correct anything, update your understanding (and re-read the relevant code if the correction changes your picture of it), give the revised paragraph, and confirm again. The instruction files are built on this understanding, so a misunderstanding left in place here ends up written into every agent's context.

## Step 4: Create or update the agentic helper files

Start by telling the user, briefly, which files you plan to create and which existing files you plan to change. Then handle each file as below. Read `references/file-guidance.md` before writing any of them: it covers what belongs in each file, what to leave out, and how to keep them short.

### Which files

- **`AGENTS.md` and `CLAUDE.md` at the top level.** The user's preference is a single source of truth with a symlink: `AGENTS.md` holds the content and `CLAUDE.md` is a relative symlink to it, created with `ln -s AGENTS.md CLAUDE.md`. See the symlink section below for how to do this safely.
- **`.claude/settings.json`.** A project permission allowlist for the repository's own read-only, build, test, lint, and format commands, so agents are not prompted for routine safe work. Never allow commands that are destructive, that publish or deploy, or that write to git.
- **Nested `AGENTS.md` / `CLAUDE.md` pairs.** Only where the review showed a subdirectory with its own tooling, commands, or conventions (a package in a monorepo, a separate frontend and backend). Do not create them for ordinary folders; a nested file that merely repeats the root file costs context in every session for nothing.

If other tools' instruction files exist (`.cursorrules`, `.cursor/rules/`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`), read them as source material and mention them to the user. Suggest consolidating into `AGENTS.md` if they overlap, but do not delete or rewrite them without the user's agreement.

Leave `.claude/settings.local.json` and `CLAUDE.local.md` alone. They are personal files and are not meant to be shared.

### New files versus existing files

- **A file that does not exist yet**: create it.
- **A file that already exists**: do not write to it until the user has approved the change. Show what you intend to change, as a diff or a clear before and after of the affected sections, and explain why each change is needed (out-of-date command, missing section, contradiction with the code). Preserve content the user wrote that is still accurate, even if you would have phrased it differently; the aim is to correct and complete their file, not to replace their voice. Apply only what they approve.

Converting an existing regular `CLAUDE.md` into the symlink arrangement counts as changing an existing file, so it needs approval too.

### The symlink arrangement

Agents find symlinked instruction files confusing in two particular ways: they may edit `CLAUDE.md` without realising it is the same file as `AGENTS.md`, and some file-writing tools replace a symlink with a regular file when writing through it, silently splitting the two. Guard against both:

1. Write the content to `AGENTS.md` only. Never write to `CLAUDE.md` once it is a symlink.
2. Put this note as the first line under the title of `AGENTS.md`, so that any future agent reading either name knows the arrangement: `> CLAUDE.md is a symlink to this file. Edit AGENTS.md directly; writing to CLAUDE.md may replace the symlink with a copy.`
3. Create the link with a relative target from the same directory: `ln -s AGENTS.md CLAUDE.md`.
4. Verify it afterwards with `ls -l CLAUDE.md` and `test -L CLAUDE.md`, and confirm `cat CLAUDE.md` shows the `AGENTS.md` content. Do not report success without this check.

Use the cases below:

- **Neither file exists**: write `AGENTS.md`, then create the symlink.
- **Only `CLAUDE.md` exists as a regular file**: propose moving its (updated) content into `AGENTS.md` and replacing `CLAUDE.md` with the symlink. Use a plain `mv CLAUDE.md AGENTS.md` (not `git mv`, which would stage the change), then create the link. Get approval first.
- **Only `AGENTS.md` exists**: propose the updates to it, then add the symlink.
- **Both exist as regular files**: compare them, propose a merged `AGENTS.md`, and propose replacing `CLAUDE.md` with the symlink. Get approval first.
- **`CLAUDE.md` is already a symlink to `AGENTS.md`**: update `AGENTS.md` only.

Fall back to a regular `CLAUDE.md` containing just `@AGENTS.md` (Claude Code's import syntax) instead of a symlink if `core.symlinks` is `false` in the preflight output, if the repository is clearly developed on Windows, or if the user asks for it. Say which approach you used and why.

## Step 5: Suggest next steps

Finish with a short report:

- the files created and changed, and whether the symlinks were verified;
- the most useful findings from the review, ordered by impact, if there are any worth acting on;
- at least one concrete next action, and say which one you recommend first. Pick whatever genuinely matters most for this repository. That could be fixing a security issue the review found, adding a missing test or lint command, resolving a contradiction between the docs and the code, or simply reviewing and committing the new files. When committing is the suggestion, give the commands for the user to run themselves, for example `git add AGENTS.md CLAUDE.md .claude/settings.json` followed by `git commit`, and do not run them.

## Things to avoid

- Running any git command that changes the repository, its index, its history, or its configuration.
- Inventing commands, paths, or conventions that you did not see in the repository.
- Putting secrets, tokens, internal URLs with credentials, or environment variable values into any file.
- Duplicating the README or rules that already live in the user's global `~/.claude/CLAUDE.md`. Instruction files are loaded into every session, so every line should earn its place.
- Writing to an existing helper file before the user has approved the change.
