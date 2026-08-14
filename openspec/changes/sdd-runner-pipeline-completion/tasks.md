<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: sdd-runner pipeline completion

Order follows the design's dependency chain: the shared post-review tail is a
prerequisite for the approve-continuation, convergence and resume are
independent of each other, gate copy last, docs and full gates at the end.
Test-first throughout: failing test before the implementation it covers.

## 1. Approve-at-early-gate continuation (Decision 1)

- [x] 1.1 Add a failing test in `tests/sdd-runner/orchestrator.test.ts`: `runGateResume` on an `approved` outcome at an early gate runs decompose, then atomicity (depth ≠ S), then presents a **final** gate at version n+1 — and does NOT mark the run completed. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (red)
- [x] 1.2 Add a failing companion case: at depth S the same continuation skips atomicity but still reaches the final gate. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (red)
- [x] 1.3 Hoist the post-convergence tail (`runPostExtendConverged`) out of `sdd-runner/src/extend-round.ts` into a shared stage module, reused by both `runExtendRound` and `runGateResume`'s approved branch, so 1.1-1.2 go green while existing extend-round tests stay green. Verify: `bun test tests/sdd-runner/orchestrator.test.ts tests/sdd-runner/extend-round.test.ts`
- [x] 1.4 Add a failing test that `finalizeGate` is now reached only via final-gate approval or abort (no path from an early gate marks `completed`). Verify: `bun test tests/sdd-runner/gate-digest.test.ts tests/sdd-runner/orchestrator.test.ts` (red), then adjust call sites to green. Verify: `bun test tests/sdd-runner`

## 2. Severity-based convergence (Decision 2)

- [x] 2.1 Add a failing test in `tests/sdd-runner/orchestrator.test.ts`: a cap-hit review result with empty `openBlockers` and empty `openMaterial` (nitpick-only) flows into decompose → atomicity → final gate without presenting an early gate. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (red)
- [x] 2.2 Implement the severity check in `runPostReviewToGate` until 2.1 is green. Verify: `bun test tests/sdd-runner/orchestrator.test.ts`
- [x] 2.3 Add explicit coverage that a cap-hit with any open MATERIAL or BLOCKER still presents an early gate and halts (pin the unchanged behavior). Verify: `bun test tests/sdd-runner/orchestrator.test.ts`

## 3. Resume covers post-review stages (Decision 3)

- [x] 3.1 Add failing tests in `tests/sdd-runner/run-state.test.ts` for `deriveResumePoint`: missing `tasks.md` with no final gate presented → `decompose`; present `tasks.md` with depth ≠ S and no atomicity report → `atomicity`; presented final gate → `gate-pending` (pin existing). Verify: `bun test tests/sdd-runner/run-state.test.ts` (red)
- [x] 3.2 Implement the new resume-point derivation (artifact/sidecar-evidence based, no new persisted fields) until 3.1 is green. Verify: `bun test tests/sdd-runner/run-state.test.ts`
- [x] 3.3 Add a failing test in `tests/sdd-runner/orchestrator.test.ts`: `runResume` re-enters at decompose (or atomicity) and continues to the final gate, sourcing the review result via `readReviewResultFromSidecars`; the `not supported yet` throw is gone for these stages. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (red)
- [x] 3.4 Implement the `runResume` stage dispatch until 3.3 is green. Verify: `bun test tests/sdd-runner/orchestrator.test.ts && bun run sdd-runner:typecheck`

## 4. Gate copy states consequences (Decision 4)

- [x] 4.1 Add failing tests in `tests/sdd-runner/gate-render.test.ts`: the early gate states that approving continues to decomposition, atomicity, and a final gate, and that extending runs one more review round; the final gate states that approving completes the run. Verify: `bun test tests/sdd-runner/gate-render.test.ts` (red)
- [x] 4.2 Update the gate renderer copy until 4.1 is green; confirm the parser is untouched (existing `gate-model` tests stay green). Verify: `bun test tests/sdd-runner/gate-render.test.ts tests/sdd-runner/gate-model.test.ts`

## 5. Docs + full verification

- [ ] 5.1 Update `docs/architecture/sdd-pipeline.md`: approve-continues semantics, severity-based convergence, resume stage coverage, and the breaking-change note for early-gate approval. Verify: `bunx openspec validate sdd-runner-pipeline-completion --strict`
- [ ] 5.2 Run the full gates. Verify: `bun test && bun run typecheck && bun run lint`
