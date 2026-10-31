# Review checklist

Nine categories. Work across all files in the skill for each one before
moving to the next; do not finish one file and then move to the next file.

## 1. Internal consistency and self-application

- Does the skill state principles or rules for its executor (for example
  "verify before relying on," "never do X")? Check whether the skill's own
  reference files actually honour those rules, not just the body of
  `SKILL.md`.
- Do different files ever state different defaults for the same decision (a
  default named one way in `SKILL.md`, and differently, or with different
  reasoning, in a reference file)?
- Are specific, perishable facts (a flag name, a tool's current behaviour,
  "X is the only supported mode," a named library recommendation) marked as
  time-bound, or presented as permanent truth? A skill read a year after it is
  written should not silently trust last year's specifics as current.
- Example shape of finding: a skill tells its executor to "always confirm the
  current flag name via `--help`" and then, two paragraphs later, instructs it
  to "set `someFlag: true`" with no such caveat attached.

## 2. Scope versus claims

- List every trigger phrase and named use case in the frontmatter
  `description` and the "when to use" section. For each one, find the place
  in the body that actually supports it.
- A named use case with no corresponding guidance anywhere in the body is a
  gap: either the skill will improvise unsupported behaviour when that
  trigger fires, or the trigger is false advertising.
- Also check the inverse: does the body assume a narrower context (for
  example "a single standalone repository") than the stated triggers promise
  (for example "scaffold a new app inside an existing repository")?

## 3. Assumed success

- For every instruction that tells the executor to run a command, install
  something, write a config value, or declare a step complete: does the skill
  require it to check the actual output or exit code, or does completion get
  inferred from the action having been attempted?
- Specifically hunt for the pattern "run X" with no corresponding "and confirm
  X actually did what it claims" nearby. The strongest version of this check,
  when a skill already uses it well, is deliberately breaking something to
  prove a check catches it (introducing a bad value and confirming a linter or
  test fails on it, then removing it). Flag anywhere this pattern would have
  been cheap to add and was not.
- Watch for claims of "done" that rest only on a file having been written (a
  workflow file, a config, a policy) rather than on that file having been
  executed or applied.

## 4. Security defaults

- For every security-relevant choice the skill makes on the user's behalf
  (credential handling, what gets logged, pinning or trust strategy for
  third-party code, permission scopes, what a security control blocks versus
  merely reports): is the chosen default the safer option, or the more
  convenient one dressed up with a safety-sounding justification?
- Does a security control run early enough to prevent the harm (for example,
  before a commit lands) or only late enough to detect it after the fact (for
  example, in CI, after the commit is already in history)? Detection-after-the
  -fact controls are weaker than a skill's own language may imply.
- Does anything the skill produces run third-party code or scripts with
  elevated trust (CI actions, install scripts, plugins) without discussing
  pinning, verification, or the consequence of that trust being misplaced?

## 5. Failure-path coverage

- List every external dependency the skill's instructions lean on: network
  access, a specific CLI tool, an emulator or device, a specific OS, an
  account or paid tier, a credential that does not exist yet. For each one,
  find where the skill says what to do when it is unavailable. No answer is a
  finding.
- Check specifically for features described as "free" or "included" that
  actually gate on a paid tier, a particular repository visibility, or an
  account the user may not have, with nothing in the skill flagging the
  condition.
- Check for necessary accounts, credentials, or subscriptions that the
  skill's output depends on (a build pipeline, a signing step, a third-party
  service) where nothing in the skill surfaces to the user, early, that they
  need to go create these.

## 6. Developer experience

- Will following the skill produce friction severe enough that a real
  developer would route around it (a slow pre-commit hook people disable, a
  threshold enforced before it means anything, a lint rule vague or strict
  enough that the first pull request suppresses it rather than fixing it)?
- Where the skill leaves a choice unnamed deliberately (to avoid going
  stale), does it give the executor enough selection criteria to avoid
  picking something that quietly breaks an implied promise (for example
  "needs no account," with no concrete option named that is actually
  guaranteed to meet that bar)?
- Is cost ever discussed where it should be? Time, money, or cognitive load,
  for choices with genuinely different cost profiles (different compute
  tiers, an enterprise tool versus a free one, a thorough check versus a fast
  one).

## 7. Silent judgment calls

- Find every place the skill bakes in an answer to a question reasonable
  teams would answer differently, especially ones with material or
  hard-to-reverse consequences (a security/maintenance tradeoff, a scope
  boundary, how thorough a check should be, how much it should cost).
- Not everything needs to become a question to the user; that would make the
  skill unusable. But anything with a material, hard-to-reverse consequence
  that was decided silently is worth flagging, even if the recommendation is
  "keep the default, just say so out loud."

## 8. Recovery and reversibility

- If the skill's process is interrupted partway through (a tool fails, the
  environment crashes, the user cancels), does anything in the skill leave
  the work in a recoverable, diagnosable state (version control hygiene,
  incremental checkpoints, idempotent steps), or could a partial run leave a
  mess with no way back to a known-good point?

## 9. Audit and compliance honesty

- Where the skill produces something that could be read as satisfying a
  compliance, legal, or audit obligation (an accessibility standard, a
  security posture, a licensing policy), does the skill state plainly what
  its own mechanism does and does not actually prove, or does the output let
  a reader infer a stronger guarantee than what was actually checked?
