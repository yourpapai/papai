---
name: syncing-plan-with-code
description: Use when an implementation plan has drifted from the code on the branch — stale line numbers, outdated snippets, tasks already half-done in a different shape, or the diff contains changes that have nothing to do with the plan's stated goal
---

# Syncing a Plan With the Code

## Overview

Re-anchor a written plan to the current state of the branch. Two failure modes get fixed in one pass: stale anchors in the plan, and off-goal changes in the diff that the plan does not mention.

**Core principle:** The plan's `Goal` defines what is in scope. The code defines what currently exists. Reconcile both directions — never silently absorb scope creep into the plan, never silently update the plan to lie about what shipped.

**Violating the letter of this rule is violating the spirit of this rule.**

**Announce at start:** "I'm using the syncing-plan-with-code skill to reconcile this plan with the branch."

## The Iron Law

```
EVERY CHANGED FILE AND EVERY PLAN TASK LANDS IN THE DISCREPANCY TABLE.
OFF-GOAL CHANGES NEVER GET ABSORBED INTO THE PLAN.
```

Skipping the table = guessing. Folding off-goal work into the plan = laundering scope creep.

## When to Use

- Plan in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` is partly implemented and the user says it has drifted, contains unrelated work, or has stale line numbers/snippets
- An execution session was interrupted and the next session needs an accurate handoff
- The branch was rebased and the plan's anchors no longer point at the right code
- Code review surfaced changes that don't belong with the plan's goal

**Do NOT use when:**

- The plan was never started — revise it with `superpowers:writing-plans` instead
- Continuing execution as-is — that's `superpowers:executing-plans`
- The user wants to redesign the feature — use `brainstorming` then `writing-plans`

## The Process

### Step 1: Pin the plan and the diff base

- Confirm the exact plan file path.
- Identify the comparison base (preference order): `**Branch:**` annotation in the plan → `git merge-base HEAD origin/main` → ask the user.
- Capture the actual changes:
  ```bash
  git fetch origin main
  git diff $(git merge-base HEAD origin/main)...HEAD --name-status
  git log $(git merge-base HEAD origin/main)..HEAD --oneline
  ```

### Step 2: Extract the plan's contract

Read the plan end to end. Pull out, in writing:

- **Goal** — the single-sentence objective. If absent, **stop and ask the user to state it.** You cannot judge scope creep without a goal.
- **Tasks** — every `### Task N:` and its checkboxes
- **Expected files** — every path under `Files:` or in code fences
- **Anchors** — every line number, function name, snippet
- **Verification commands** — every `bun test ...`, `bun lint`, etc.

### Step 3: Build the discrepancy table

Coverage check is mandatory: every changed file in the diff **and** every plan task lands in exactly one row.

| Category                   | Definition                                                                     | Default disposition                                                                            |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **In-plan, accurate**      | Code matches a task; anchors still correct                                     | Flip task to `[x]`                                                                             |
| **In-plan, stale anchors** | Code matches a task but line numbers/snippets/paths are wrong                  | Refresh anchors from current file                                                              |
| **In-plan, partial**       | Task is half-done                                                              | Rewrite task to describe **what's left**, with current anchors. Stay `[ ]`                     |
| **In-plan, divergent**     | Task done in a different shape than the plan said                              | **Ask user:** plan wins (revert and redo) or code wins (rewrite task to match)                 |
| **Out-of-plan, on-goal**   | Diff change not in plan but required by Goal                                   | **Ask user**, then add a new task. Never absorb silently                                       |
| **Out-of-plan, off-goal**  | Diff change has no link to Goal — drive-by refactor, formatting, unrelated fix | **Ask user per item:** revert, or split into sidecar follow-up plan. Never fold into this plan |
| **Missing**                | Plan task has no corresponding code change                                     | Stay `[ ]`; refresh anchors if surrounding code moved                                          |

### Step 4: Get decisions, one at a time

Show the table to the user. For every row whose disposition requires a decision (Out-of-plan, In-plan divergent), ask **one question per row**. Do not batch. Do not assume. Record each decision next to the row.

### Step 5: Edit the plan

- **Stale anchors** → re-open each referenced file before pasting; never edit anchors from memory
- **Partial / divergent** → rewrite task body to describe **remaining** work; keep task heading and number stable so cross-references hold
- **Completed** → flip every checkbox under the task to `[x]`; do not delete the body
- **Out-of-plan, on-goal** → insert new `### Task N+1:` matching the plan's existing style (TDD red → green → commit, exact file paths, no placeholders — see `superpowers:writing-plans`)
- **Out-of-plan, off-goal, split** → create `docs/superpowers/plans/YYYY-MM-DD-<plan-slug>-followup.md`; add an `## Out-of-Scope (Tracked Separately)` section to the original with one cross-reference line
- **Out-of-plan, off-goal, revert** → leave the plan unchanged for that change; record "Pending revert" in the Drift Log; tell the user a revert session is needed

### Step 6: Append the Drift Log

At the bottom of the plan, append (never overwrite) a section like:

```markdown
## Drift Log

| Date       | Category               | Item                                        | Decision                                              |
| ---------- | ---------------------- | ------------------------------------------- | ----------------------------------------------------- |
| 2026-04-29 | In-plan, stale anchors | Task 4 line numbers in `loop-controller.ts` | Updated 67 → 81, 89 → 103                             |
| 2026-04-29 | Out-of-plan, off-goal  | `src/utils/format-date.ts` timezone helper  | Split to `2026-04-29-...-followup.md`, pending revert |
```

Every decision from Step 4 has a row. Append-only.

### Step 7: Verify the resynced plan

- Re-open every file path the plan now references; confirm it exists.
- Re-open every line number; confirm the surrounding code matches the plan's claim.
- Run every verification command the plan lists; if a command no longer applies, repair it in-plan rather than dropping it.
- `git diff` the plan file and read your own edit. Hand-edited line numbers are the highest-risk surface here.

**REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` before claiming the resync is done.

### Step 8: Hand off

End your turn. Do not start executing the cleaned plan. Do not start reverting flagged code. Both are separate sessions.

## Common Rationalizations

| Excuse                                                                     | Reality                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "The off-goal change is small, I'll fold it into an existing task"         | That's the failure mode the user is fixing. Split it.                                                |
| "The line numbers are off by two — readers will figure it out"             | A plan with wrong anchors is worse than no plan. Refresh them.                                       |
| "The new shape is better, I'll silently rewrite the task"                  | "Better" is a user decision. Surface the divergence.                                                 |
| "I'll just `git revert` the unrelated commit, it obviously doesn't belong" | Reverts are destructive and visible. Get explicit per-commit approval; revert in a separate session. |
| "The Goal sentence is fuzzy, I'll tighten it while I'm here"               | Goal edits change scope. Ask.                                                                        |
| "The drive-by lint fix was needed for the test, so it's on-goal"           | Only on-goal if the plan said so. Otherwise it's a follow-up.                                        |
| "I'll mark it `[x]`, the last bit is trivial"                              | `[x]` means the code in the branch satisfies the task. If it doesn't, it isn't done.                 |
| "I'll delete the original task body since the new shape differs"           | Update the body to describe **remaining** work. Preserve history in the Drift Log.                   |
| "The verification command is flaky, I'll drop it"                          | Drop = silently weakens the contract. Repair or replace; don't delete.                               |
| "Anchors-only is fine, I'll skip the off-goal audit"                       | Then the plan keeps lying about what shipped.                                                        |

## Red Flags — STOP

- About to run `git reset`, `git revert`, `git restore`, `git checkout --`, or `git stash`
- About to edit a source file under `src/`, `client/`, `tests/`, `scripts/` "to make the plan match"
- About to flip a task to `[x]` without having opened the implementation file
- About to delete or rewrite the plan's `Goal` line
- About to add a task whose body covers work outside the original Goal
- About to remove a verification command instead of repairing it
- Thinking "the user clearly wants this kept, no need to ask"
- Thinking "this drift is small, the Drift Log is overkill"

**All of these mean: stop, return to the table, ask the user.**

## Quick Reference

| Step                 | Output                                                      |
| -------------------- | ----------------------------------------------------------- |
| 1. Pin plan + base   | plan path, merge base, file/commit list                     |
| 2. Extract contract  | Goal, tasks, expected files, anchors, verification commands |
| 3. Discrepancy table | every diff entry + every task in exactly one row            |
| 4. Decisions         | per-row choice from user, one question at a time            |
| 5. Plan edits        | refreshed tasks, statuses, anchors; sidecar plan if needed  |
| 6. Drift Log         | append-only table at bottom of plan                         |
| 7. Verify            | every anchor and command checked against current code       |
| 8. Hand off          | stop; do not execute, do not revert                         |

## Integration

**Called when:**

- An execution session (`superpowers:executing-plans`, `superpowers:subagent-driven-development`) has produced a branch whose plan no longer matches the diff

**Pairs with:**

- `superpowers:writing-plans` — style conventions for any new tasks added to the synced plan or the sidecar follow-up plan
- `superpowers:verification-before-completion` — Step 7 must use it before claiming the resync is done
- `superpowers:executing-plans` — the next session, against the cleaned plan

## The Bottom Line

The plan is the contract. The code is the truth. Reconcile both, document every decision, never absorb scope creep.

If the table has gaps, you guessed. If a task is `[x]` without an open-file check, you lied. If an off-goal change ended up as a new task in this plan, you laundered it.

No shortcuts.
