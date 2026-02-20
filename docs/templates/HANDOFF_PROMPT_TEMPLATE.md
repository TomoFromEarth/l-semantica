# L-Semantica Handoff Prompt Template

Use this template at the end of a working thread to hand context to the next thread with minimal loss.

## Copy-Paste Prompt (Fill Every Section)

```md
You are continuing work on L-Semantica.

## Session Metadata
- Date (UTC): <YYYY-MM-DD>
- Handoff author: <name>
- Milestone: <M0|M1|...>
- Phase: <0|1|2|...>
- Primary issue: <#number>
- Related issues: <#number, #number>
- PR: <url or N/A>
- Branch: <gh-<issue-number>/<short-kebab-summary>>
- Base branch: main
- Commit SHA at handoff: <sha>

## Objective
- One-sentence goal of the current work:
  - <goal>

## Scope
- In scope:
  - <items>
- Out of scope:
  - <items>

## Current Status
- Completed in this thread:
  - <items>
- Remaining tasks (ordered):
  1. <task>
  2. <task>
  3. <task>

## Decisions and Rationale
- Decision: <what>
  - Why: <reason>
  - Tradeoff: <cost>
- Decision: <what>
  - Why: <reason>
  - Tradeoff: <cost>

## Files Changed
- <absolute-or-repo-path>
  - Change summary: <what changed>
  - Why changed: <reason>

## Files Likely Next
- <path>
  - Planned change: <what to do next>

## Commands Run
- Setup/install:
  - `<command>`
- Validation:
  - `<command>`
- Build/test/lint/typecheck outcomes:
  - `<pass/fail + key output>`

## Verification Snapshot
- Lint: <pass/fail>
- Typecheck: <pass/fail>
- Tests: <pass/fail>
- CI status (if PR exists): <status>

## Known Risks / Open Questions
- Risk: <description>
  - Mitigation: <next action>
- Open question: <question>
  - Owner: <who decides>

## Git/GitHub State
- Local status:
  - `<output of git status --short --branch>`
- Last commit:
  - `<sha> <message>`
- Remote sync:
  - <ahead/behind/clean>
- Issue updates needed:
  - <which issues need comment/status update>
- PR updates needed:
  - <review threads to resolve, labels, milestone>

## Next Thread Start Checklist
1. `git switch <branch>`
2. `git pull --ff-only origin <branch>`
3. Run validation baseline:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
4. Execute next task:
   - <task>

## Expected First Deliverable In Next Thread
- <single concrete outcome>

## Hard Constraints To Preserve
- Keep branch naming: `gh-<issue-number>/<short-kebab-summary>`.
- Keep PRs small and issue-linked.
- Run lint/typecheck/tests before commit.
- Do not expand scope without updating issue + PR notes.
```

## Minimal Handoff Variant (When Time Is Tight)

```md
Continuing L-Semantica.
Branch: <branch>
Issue: <#>
Goal: <one sentence>
Done: <bullets>
Next: 1) <task> 2) <task>
Files touched: <paths>
Validation: lint=<pass/fail>, typecheck=<pass/fail>, test=<pass/fail>
Risks: <bullets>
First command: <command>
```

## Recommended Usage
1. Store completed handoffs in `docs/handoffs/` as dated files, for example:
   - `docs/handoffs/2026-02-20-issue-4-workspace-bootstrap.md`
2. Paste the full handoff prompt into the next thread's first message.
3. Include absolute outcomes, not vague summaries.
4. If scope changes, update issue and PR text in the same session.
