# Guidance for agentic helper files

Read this before writing or changing any of the files in Step 4.

## Contents

1. Principles that apply to every file
2. Top-level `AGENTS.md`
3. Nested `AGENTS.md`
4. `.claude/settings.json`
5. Checking your work

## 1. Principles that apply to every file

These files are loaded into an agent's context at the start of every session, so they cost something every time and are trusted by default. That leads to a few rules of thumb.

- **Accurate beats complete.** A wrong command or a stale path is worse than a missing one, because the agent will follow it confidently. Only record what you verified in the repository.
- **Short beats thorough.** Aim for roughly 50 to 150 lines for a top-level file. If something is long and only occasionally needed (a full deployment runbook, an API reference), link to the existing document instead of copying it in.
- **Write for an agent that is new to the repo.** Explain what is not obvious from the code: why something is done a particular way, what will break if it is changed, which files are generated. Skip what any competent developer would see at a glance.
- **Say what to do, not only what to avoid.** "Run `pnpm test -- path/to/file`" is more useful than "do not run the whole suite". Where a prohibition is needed, give the reason.
- **No secrets.** Name environment variables if agents need to know they exist; never include their values.

## 2. Top-level `AGENTS.md`

Use the sections below as a starting point. Drop any that have nothing useful to say for this repository, and keep headings plain so humans can scan the file too.

```markdown
# <Project name>

> CLAUDE.md is a symlink to this file. Edit AGENTS.md directly; writing to CLAUDE.md may replace the symlink with a copy.

<The confirmed summary paragraph from Step 3, trimmed if needed.>

## Commands

<Exact, verified commands, in a code block, each with a short comment: install, build, run locally, run all tests, run a single test, lint, format, type-check. Note any that are slow or need a service running.>

## Project layout

<A short map of the directories that matter and what lives in each. Not every folder, only the ones an agent needs to find its way.>

## Conventions

<Conventions that are not obvious from the code: patterns to follow, libraries to prefer, error handling, naming, test style, commit message style if the history shows one.>

## Gotchas

<Generated files not to edit by hand, required environment variable names, migrations, external services, flaky or slow areas, anything that has caught people out.>

## Working in this repo

<How an agent should verify its work before finishing (for example: run lint and the affected tests), and any areas that need extra care or human sign-off.>
```

Leave the symlink note out when the fallback arrangement (a `CLAUDE.md` containing `@AGENTS.md`) is used, and put this instead: `> CLAUDE.md imports this file. Edit AGENTS.md directly.`

When updating an existing file, keep its structure where it works. Do not reorganise a file the user has written just to match this template.

## 3. Nested `AGENTS.md`

Only for a subdirectory with its own tooling or conventions. It should cover what is different there and nothing else: that package's commands, its layout, and its specific conventions. Do not repeat the root file; agents read both. Use the same symlink arrangement and note as the root.

## 4. `.claude/settings.json`

This file is shared with everyone who clones the repository, so it should contain only permissions that are safe for anyone. Allow the project's own routine commands that you verified exist, so agents can build, test, lint, and format without prompting. Deny reading obvious secret files.

Rule syntax: `Bash(<command>)` matches that exact command, and `Bash(<prefix>:*)` matches any command starting with the prefix, so `Bash(pnpm test:*)` covers `pnpm test` and `pnpm test -- src/foo.test.ts`. Write the prefix as the command an agent would actually type (for example `Bash(node --test:*)`), not as a path fragment.

Example for a Node project using pnpm:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(pnpm test:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm build)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)"
    ]
  }
}
```

Do not allow:

- dependency installation or upgrades (`npm install`, `pnpm install`, `pip install`, `bundle install`, and the like), because these run arbitrary package scripts and change lockfiles; agents should ask first;
- anything that deploys, publishes, or releases (`npm publish`, `terraform apply`, `kubectl`, deploy scripts);
- anything that deletes broadly (`rm -rf`, database reset or drop scripts);
- any git command that writes (`git add`, `git commit`, `git push`, `git checkout`, `git reset`);
- broad wildcards such as `Bash(*)` or `Bash(npm:*)`, which would let an agent run any script in the manifest.

If the file already exists, propose additions and removals as a diff and wait for approval. Keep any existing entries the user added unless they are unsafe, in which case explain why and let the user decide.

## 5. Checking your work

Before reporting back in Step 5:

- re-read each written file once, as if you were an agent arriving fresh, and remove anything that is vague, duplicated, or unverified;
- check that every command in the files is defined in the repository's manifests, Makefile, or CI configuration, or is a direct use of a tool the repository already relies on, and that any command you could not run, or that failed, is marked as such;
- if `.claude/settings.json` was written, check it is valid JSON (for example with `python3 -m json.tool .claude/settings.json`);
- for each symlink, run `ls -l` and `test -L` and confirm `cat` shows the expected content.
