<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# walk-item-green-decomposition

## Context

- The walk's premise is code, not prose: `afk-runner/src/work/run-check.ts:15-19`
  — `test:affected` "derives the changed set from the working tree itself, and
  between slice commits that tree is exactly the current item's work". A red
  pre-impl test item violates the premise by design: its work is red, it
  fails the check, nothing commits, and the red file rides the tree into every
  later item's check (the cascade that took Run U to 0/24).
- The cause is prompt-shaped (U13 notes §2/§3 evidence): both C9 decomposers
  (glm-5.3-flash and glm-5.3, independently) split test/impl items following
  repo conventions; `buildDecomposerPrompt` (`work/decompose.ts:37-50`) carries
  zero granularity guidance; `buildAtomicityPrompt`'s "Every task must end
  with its verification command" (`work/atomicity.ts:26-28`) reads as licensing
  test-only items.
- The measured correct granularity is the operator's own C9 fix: every hand
  re-target was a pair-merge (2.4+2.5, 2.3+2.6, 3.1+3.3, 3.2+3.4) — one item
  = one complete red→green cycle, exactly how the merged items behaved
  post-merge.
- The repo's write-hook TDD (red-first at write time) composes with item-level
  green: the red phase happens inside one implementer bracket (write the
  failing test, watch it fail, implement, watch it pass); the per-item check
  then sees green. No conflict with hook policy.

## Goals / Non-Goals

**Goals:**

- Both tail prompts state the walk-granularity constraint in operational
  terms an LLM decomposer cannot misread as licensing test-only items.
- The constraint is pinned by tests so it cannot silently regress.
- Everything else in the walk stays byte-identical.

**Non-Goals:** check tolerance, decompose-exit lint, red-work containment,
any attempt/budget/escalation change (all recorded in proposal Non-goals with
wake triggers where falsifiable).

## Decisions

**D1 — Constraint text lives in the runner prompts.** `buildDecomposerPrompt`
and `buildAtomicityPrompt` are the one seam every decomposition-shaped spawn
crosses; the openspec tasks instruction (`driver.instructions('tasks', …)`) is
human-facing, shared across authoring flows, and would carry the constraint
where no walk exists. Wording (operational, not normative-abstract):
decomposer gains — "Every task must be one complete red→green cycle: the
failing test and its implementation land in the same task. Never split a test
into its own task — the executor verifies each task by running the repo's
affected-test check on the working tree, so every task must leave the tree
green." Atomicity's lines reword to the same invariant ("merge a test with the
implementation it verifies; every task must be independently green, not merely
independently described").

**D2 — Prompt-only enforcement; strict-validate retry unchanged.** The
decomposer's existing two-attempt strict-validation loop stays the only
structural gate. A lint (test-only item detection) is text heuristics over an
LLM's phrasing — brittle, and unnecessary while the prompt fix is untested
live. Wake trigger: a future armed run whose decomposer still splits red-first
pairs despite the constraint (then the lint — or the escalation resumeHint
naming the merge — is evidence-owed).

**D3 — The check side is the fixed point.** `AFFECTED_CHECK_COMMAND`,
`runAffectedCheck`, `commitTaskSlice`, verify routing, and `fixTargetOf` are
untouched. The U13 audit rejected the tolerance alternative on mechanism (D3
there); this change is the adopted half of that decision only.

**D4 — TDD order.** Red-first over the prompt builders: extend
`tests/afk-runner/work/decompose.test.ts` and `atomicity.test.ts` to assert
the constraint sentences and the de-licensed verification-command wording
(fail), then edit the two builders (pass). The write hooks gate
`afk-runner/src/**` as usual; no new hook surface.

**D5 — Live verification rides the next armed cycle** (owed by this change,
recorded in its proposal): an armed run on a red-first-prone task asserting
zero operator re-targets — the F-P2 drill. Fixture-only coverage cannot prove
prompt behavior against a real decomposer.

## Risks / Trade-offs

- **Granularity pressure toward coarser items** — bounded: the constraint is
  pairing-shaped, not size-shaped, and atomicity's split clause remains (large
  items still split; they split into green-complete units). C8's consolidate
  veto showed granularity is the decomposer's hardest job either way.
- **Wording drift** — pinned by D4's tests (sentence-level anchors, the house
  pattern for prompt builders).
- **A decomposer that ignores the constraint** — the attempts bound and the
  escalation gate already contain it honestly; D2's wake trigger upgrades the
  guard on evidence.
