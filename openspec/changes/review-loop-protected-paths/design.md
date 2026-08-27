# Design: review-loop-protected-paths

## Context

Two mechanisms already exist on the opencode-agent side: `PROTECTED_PATHS_RULE`
(`opencode-agent/src/protected-paths.ts`) carried by the four instruction blocks that can write a
file (implementation, CI-fix, plan-draft ×2, pinned by `tests/opencode-agent/instructions.test.ts`),
and the review-phase push guard — `dropUnpushable` in `opencode-agent/src/phases/review-push.ts`
driving `revertPaths` (`git-revert.ts`) — which reverts protected paths before a push. Run
32992114904 shows both gaps: the review loop's prompts (review-loop/src/prompt-templates.ts) carry
no rule, so its fixer edited `.github/workflows/ci.yml` (`df1025cb5`); the guard reverted it
(`e2b213562`) and pushed, but recorded as `pushedAt` the head read **before** its own revert
commit, so the final guard pass at 18:00:13 ran `revertPaths(since = the pre-revert head)` —
which restores the protected content — and the push at 18:00:15 was refused whole.

The minimality rule already crosses this workspace boundary by duplication plus a pinning test
(`MINIMALITY_LADDER` ↔ `MINIMALITY_RULE`, `tests/opencode-agent/minimality-rule.test.ts`).

## Goals / Non-Goals

**Goals:**

- The review loop's reviewer/fixer prompts state the protected-paths rule with one definition.
- A workflow-fix finding costs zero wasted fixer edit cycles and lands in the maintainer-visible
  channel (`needs_human` reasoning, run summary).
- The push guard's recorded push point always names the head the remote accepted.

**Non-Goals:**

- No changes to `PROTECTED_PREFIXES`, the staging guard, or permissions (proposal Non-goals).
- No new plumbing to surface the loop's unmerged protected edit content beyond existing channels.

## Decisions

### D1: Duplicate the rule into `prompt-templates.ts`, pin equal, add one schema-mapping line

`review-loop/src/prompt-templates.ts` gains an exported `PROTECTED_PATHS_RULE` holding the exact
text of `opencode-agent`'s constant, plus one
review-loop-specific line mapping "say in your reply" onto the fixer's result schema: return
verdict `needs_human` and describe the exact change in `reasoning`. A new pinning test beside
`minimality-rule.test.ts` asserts the two constants' shared core stays identical.

*Why duplication + pin, not import:* the same argument as minimality — opencode-agent drives
review-loop as a subprocess and imports nothing from it; a runtime import for one paragraph is a
boundary to defend at every later refactor. *Why the extra mapping line:* the agent-side rule
says "say in your reply"; a fixer has no reply, it has a JSON result — without the mapping the
rule's manual-application half has no landing place and the fixer would either edit the file or
hand back an empty `needs_human`. The pinning test asserts containment (the shared text appears
verbatim inside the fixer block), so the mapping line cannot fork the definition.

*Alternative declined:* restating the rule in fixer-native wording only. That breaks the
single-definition invariant the minimality precedent established, and a later rewording of the
agent-side constant would silently leave the loop's copy behind.

### D2: Carriers — the three fix prompts and the reviewer prompt

`buildFixPrompt`, `buildRetryFixPrompt` and `buildRetryFixWithInspectorFeedbackPrompt` carry the
rule (retry prompts included for the same reason minimality is: a second attempt is where scope
creeps). `buildReviewPrompt` carries a one-line form: a finding whose fix requires editing a
protected path describes the change in `suggestedFix` for manual application — the reviewer
still *reports* the defect (it is real), it just does not route it to an edit. The inspect
prompts judge diffs and write nothing; they carry nothing.

*Why the reviewer too:* without it, every workflow-fix finding buys a full fixer cycle that can
only end in `needs_human` — the same wasted-socket shape the fixer-side rule exists to prevent,
one layer earlier.

### D3: Record the post-revert head as the push point

In `pushIfMoved` (`review-push.ts`), replace `pushedAt = Promise.resolve(head)` — the head read
before reconcile and revert ran — with a fresh `readHead` after the push. `readHead` already
fails open (`null` = push regardless), so a checkout that cannot answer degrades to the
pre-change behaviour, never to a skipped push. Everything `pushedAt` feeds stays as it is:
`changedSince(since)` for the next guard pass, and the moved-comparison — for both, "the head
the remote accepted" is the correct base; recording the pre-revert head made the guard's own
revert commit look like a protected change to restore, which is precisely the inverted
behaviour.

*Alternative declined:* teaching `dropUnpushable` to skip paths whose only change since `since`
is the guard's own revert (comparing against `origin/<branch>` instead). More moving parts, and
it answers the symptom (a stale base) rather than the cause (recording a head that was never
pushed).

### D4: Report channels stay as they are

`blocked` paths already ride into `renderReport`'s "Reverted before pushing … Apply by hand"
line, and a `needs_human` fixer verdict already lands in the loop's fenced summary. No new
channel is built; the change makes the *content* arrive (D1/D2) and the push survive (D3).

## Risks / Trade-offs

- [A fixer ignores the instruction and edits a workflow file anyway] → the push guard still
  reverts before pushing, and — with D3 — the guard now survives its own second pass. The
  instruction shapes generation; the guard remains the mechanism (the standing
  `stageAllowed`/prompt doctrine).
- [The loop's branch still carries an unmergeable protected edit after a revert, and the final
  merge conflicts as it did at 17:51/18:00] → that now ends as `outcome: failed` with the
  finding named in the summary (`needs_human` reasoning per D1), rather than as a refused push
  with the run red and the remedy invisible. Residual, accepted: the *content* of the loop-side
  edit is only in the encrypted transcript and the summary prose.
- [Pinning containment rather than byte equality of the whole fixer block] → a carrier could
  append text that contradicts the rule. Same exposure as the minimality pin; the reviewer of
  any such edit has the test naming the constant one keystroke away.

## Migration Plan

Single commit on a branch; both workspaces are developer tooling with no runtime coupling.
Rollback is revert — no persisted state, schema, or workflow shape moves. In-flight agent issues
need nothing: the next `/review` picks up the new prompts, and `AGENT_STATE` is untouched.
