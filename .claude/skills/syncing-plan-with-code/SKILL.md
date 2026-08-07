---
name: syncing-plan-with-code
description: Use when an OpenSpec change has drifted from the code on the branch — stale line numbers, outdated snippets, tasks already half-done in a different shape, or the diff contains changes that have nothing to do with the change's stated goal
---

# Syncing a Change With the Code

## Overview

Re-anchor an OpenSpec change's artifacts to the current state of the branch. Two failure modes get fixed in one pass: stale anchors in the artifacts, and off-goal changes in the diff that the change does not mention.

**Core principle:** The change's `proposal.md` defines what is in scope. The code defines what currently exists. Reconcile both directions — never silently absorb scope creep into the change, never silently update artifacts to lie about what shipped.

**Violating the letter of this rule is violating the spirit of this rule.**

**Announce at start:** "I'm using the syncing-plan-with-code skill to reconcile this change with the branch."

## The Iron Law

```
EVERY CHANGED FILE AND EVERY CHANGE TASK LANDS IN THE DISCREPANCY TABLE.
OFF-GOAL CHANGES NEVER GET ABSORBED INTO THE CHANGE.
```

Skipping the table = guessing. Folding off-goal work into the change = laundering scope creep.

## When to Use

- A change under `openspec/changes/<name>/` is partly implemented and the user says it has drifted, contains unrelated work, or has stale line numbers/snippets in `tasks.md` / `design.md`
- An `/opsx:apply` session was interrupted and the next session needs an accurate handoff
- The branch was rebased and the artifacts' anchors no longer point at the right code
- Code review surfaced changes that don't belong with the change's goal

**Do NOT use when:**

- The change was never started — revise its artifacts with `/opsx:update` instead
- Continuing implementation as-is — that's `/opsx:apply`
- The user wants to redesign the feature — start fresh with `/opsx:explore`, then `/opsx:propose`

## The Process

### Step 1: Pin the change and the diff base

- Confirm the change name and root: `openspec/changes/<name>/`. Run `openspec status --change "<name>" --json` to see which artifacts exist.
- Identify the comparison base (preference order): `**Branch:**` annotation in the artifacts → `git merge-base HEAD origin/main` → ask the user.
- Capture the actual changes:
  ```bash
  git fetch origin main
  git diff $(git merge-base HEAD origin/main)...HEAD --name-status
  git log $(git merge-base HEAD origin/main)..HEAD --oneline
  ```

### Step 2: Extract the change's contract

Read `proposal.md`, `design.md` (if present), and `tasks.md` end to end. Pull out, in writing:

- **Goal** — the objective stated in `proposal.md`. If absent, **stop and ask the user to state it.** You cannot judge scope creep without a goal.
- **Tasks** — every checkbox item in `tasks.md`
- **Expected files** — every path named in `tasks.md` / `design.md` or in code fences
- **Anchors** — every line number, function name, snippet
- **Verification commands** — every `bun test ...`, `bun lint`, etc.

### Step 3: Build the discrepancy table

Coverage check is mandatory: every changed file in the diff **and** every change task lands in exactly one row.

| Category                   | Definition                                                                     | Default disposition                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **In-plan, accurate**      | Code matches a task; anchors still correct                                     | Flip task to `[x]`                                                                           |
| **In-plan, stale anchors** | Code matches a task but line numbers/snippets/paths are wrong                  | Refresh anchors from current file                                                            |
| **In-plan, partial**       | Task is half-done                                                              | Rewrite task to describe **what's left**, with current anchors. Stay `[ ]`                   |
| **In-plan, divergent**     | Task done in a different shape than the artifacts said                         | **Ask user:** artifacts win (revert and redo) or code wins (rewrite task to match)           |
| **Out-of-plan, on-goal**   | Diff change not in artifacts but required by Goal                              | **Ask user**, then add a new task. Never absorb silently                                     |
| **Out-of-plan, off-goal**  | Diff change has no link to Goal — drive-by refactor, formatting, unrelated fix | **Ask user per item:** revert, or split into a follow-up change. Never fold into this change |
| **Missing**                | Task has no corresponding code change                                          | Stay `[ ]`; refresh anchors if surrounding code moved                                        |

### Step 4: Get decisions, one at a time

Show the table to the user. For every row whose disposition requires a decision (Out-of-plan, In-plan divergent), ask **one question per row**. Do not batch. Do not assume. Record each decision next to the row.

### Step 5: Update the artifacts via `/opsx:update`

All artifact edits go through the `openspec-update-change` skill (`/opsx:update`), which keeps `proposal.md`, `design.md`, and `tasks.md` coherent with one another:

- **Stale anchors** → re-open each referenced file before pasting; never edit anchors from memory
- **Partial / divergent** → rewrite the task body in `tasks.md` to describe **remaining** work; keep task numbering stable so cross-references hold
- **Completed** → flip every checkbox under the task to `[x]`; do not delete the body
- **Out-of-plan, on-goal** → add a new task in `tasks.md` matching the change's existing style (exact file paths, verification commands, no placeholders); adjust `proposal.md` / `design.md` scope wording if needed
- **Out-of-plan, off-goal, split** → `/opsx:propose` a follow-up change carrying that work; note the new change's name in this change's Drift Log
- **Out-of-plan, off-goal, revert** → leave the artifacts unchanged for that change; record "Pending revert" in the Drift Log; tell the user a revert session is needed

### Step 6: Append the Drift Log

At the bottom of `tasks.md`, append (never overwrite) a section like:

```markdown
## Drift Log

| Date       | Category               | Item                                        | Decision                                            |
| ---------- | ---------------------- | ------------------------------------------- | --------------------------------------------------- |
| 2026-04-29 | In-plan, stale anchors | Task 4 line numbers in `loop-controller.ts` | Updated 67 → 81, 89 → 103                           |
| 2026-04-29 | Out-of-plan, off-goal  | `src/utils/format-date.ts` timezone helper  | Split to follow-up change `fix-timezone-formatting` |
```

Every decision from Step 4 has a row. Append-only.

### Step 7: Verify the resynced change

- Re-open every file path the artifacts now reference; confirm each exists.
- Re-open every line number; confirm the surrounding code matches the artifact's claim.
- Run every verification command the artifacts list; if a command no longer applies, repair it in-place rather than dropping it.
- `git diff` the change directory and read your own edits. Hand-edited line numbers are the highest-risk surface here.

**REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` before claiming the resync is done.

### Step 8: Hand off

End your turn. Do not start implementing the cleaned change. Do not start reverting flagged code. Both are separate sessions.

## Common Rationalizations

| Excuse                                                                     | Reality                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "The off-goal change is small, I'll fold it into an existing task"         | That's the failure mode the user is fixing. Split it.                                                |
| "The line numbers are off by two — readers will figure it out"             | Artifacts with wrong anchors are worse than no artifacts. Refresh them.                              |
| "The new shape is better, I'll silently rewrite the task"                  | "Better" is a user decision. Surface the divergence.                                                 |
| "I'll just `git revert` the unrelated commit, it obviously doesn't belong" | Reverts are destructive and visible. Get explicit per-commit approval; revert in a separate session. |
| "The Goal sentence is fuzzy, I'll tighten it while I'm here"               | Goal edits change scope. Ask.                                                                        |
| "The drive-by lint fix was needed for the test, so it's on-goal"           | Only on-goal if the artifacts said so. Otherwise it's a follow-up change.                            |
| "I'll mark it `[x]`, the last bit is trivial"                              | `[x]` means the code in the branch satisfies the task. If it doesn't, it isn't done.                 |
| "I'll delete the original task body since the new shape differs"           | Update the body to describe **remaining** work. Preserve history in the Drift Log.                   |
| "The verification command is flaky, I'll drop it"                          | Drop = silently weakens the contract. Repair or replace; don't delete.                               |
| "Anchors-only is fine, I'll skip the off-goal audit"                       | Then the artifacts keep lying about what shipped.                                                    |

## Red Flags — STOP

- About to run `git reset`, `git revert`, `git restore`, `git checkout --`, or `git stash`
- About to edit a source file under `src/`, `client/`, `tests/`, `scripts/` "to make the artifacts match"
- About to flip a task to `[x]` without having opened the implementation file
- About to delete or rewrite the goal stated in `proposal.md`
- About to add a task whose body covers work outside the original goal
- About to remove a verification command instead of repairing it
- Thinking "the user clearly wants this kept, no need to ask"
- Thinking "this drift is small, the Drift Log is overkill"

**All of these mean: stop, return to the table, ask the user.**

## Quick Reference

| Step                 | Output                                                      |
| -------------------- | ----------------------------------------------------------- |
| 1. Pin change + base | change root, merge base, file/commit list                   |
| 2. Extract contract  | goal, tasks, expected files, anchors, verification commands |
| 3. Discrepancy table | every diff entry + every task in exactly one row            |
| 4. Decisions         | per-row choice from user, one question at a time            |
| 5. Artifact edits    | refreshed tasks, statuses, anchors; follow-up change if any |
| 6. Drift Log         | append-only table at bottom of `tasks.md`                   |
| 7. Verify            | every anchor and command checked against current code       |
| 8. Hand off          | stop; do not implement, do not revert                       |

## Integration

**Called when:**

- An `/opsx:apply` session has produced a branch whose change artifacts no longer match the diff

**Pairs with:**

- `openspec-update-change` (`/opsx:update`) — all artifact edits from Step 5 go through it
- `openspec-propose` (`/opsx:propose`) — creates the follow-up change for split off-goal work
- `superpowers:verification-before-completion` — Step 7 must use it before claiming the resync is done
- `openspec-apply-change` (`/opsx:apply`) — the next session, against the cleaned change

## The Bottom Line

The change's artifacts are the contract. The code is the truth. Reconcile both, document every decision, never absorb scope creep.

If the table has gaps, you guessed. If a task is `[x]` without an open-file check, you lied. If an off-goal change ended up as a new task in this change, you laundered it.

No shortcuts.
