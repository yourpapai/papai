## 1. ReviewLoopResult.openMaterial (design D3)

- [x] 1.1 Failing test in `tests/sdd-runner/review-loop.test.ts` (extend the existing `cap-hit` case near line 207): a cap-hit `ReviewLoopResult` exposes `openMaterial` containing the final round's MATERIAL resolutions (filtered by `class === 'MATERIAL'`), parallel to the existing `openBlockers` assertion. Verify: `bun test tests/sdd-runner/review-loop.test.ts` (fails)
- [x] 1.2 Add `openMaterial: readonly Resolution[]` to `ReviewLoopResult` (`review-loop.ts:46`); populate in `runRound` (`review-loop.ts:140-141`) by filtering the final round's resolutions on `class === 'MATERIAL'`, mirroring the existing `openBlockers` filter. Verify: `bun test tests/sdd-runner/review-loop.test.ts`; `bun run typecheck`

## 2. Gate surface: trajectory + open MATERIAL (design D2)

- [x] 2.1 Failing tests in `tests/sdd-runner/gate-model.test.ts` (extend the `writeGateDigest` describe block near line 54): when `mode === 'early'` and `openMaterial` is non-empty, the digest (a) renders a `### Cap-hit trajectory` block with one line per `trajectory` entry; (b) lists each `openMaterial` entry as `- [ ] F<n> <gap>` with `resolver: <resolution> — <outcome>` beneath. Verify: `bun test tests/sdd-runner/gate-model.test.ts` (fails)
- [x] 2.2 Extend `GateDigestInput` (`gate-model.ts:46`) with `openMaterial: readonly GateFinding[]` and `trajectory: readonly DigestRecord[]` (import `DigestRecord` from `replay.ts`); render the open-MATERIAL section in `writeGateDigest` between the existing blockers section and the assumptions section, and render the trajectory block by calling `formatTrajectoryBlock(trajectory)` from `renderer.ts` (shipped by `sdd-renderer-canonical-digest` — do not inline the rendering). Treat NITPICKs as count-only (not expanded). Verify: `bun test tests/sdd-runner/gate-model.test.ts`; `bun run typecheck`
- [x] 2.3 Failing test in `tests/sdd-runner/gate-digest.test.ts` (extend `blockersOf` describe near line 30): rename the helper to `findingsOf(result)` returning `{ blockers, material }`; assert `material` maps `result.openMaterial` to `{ id, gap, evidence }`. Keep `blockersOf` as a thin wrapper or update call sites. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 2.4 Rename/extend in `gate-digest.ts:126`; thread `openMaterial` + `trajectory` through `presentGateAt` (`gate-digest.ts:70`) into `GateDigestInput`. Trajectory is `replayEvents(logPathFor(state)).perRound` (the reducer already derives each `DigestRecord` from the convergence + finding events — do not re-read raw convergence events or re-derive counts). Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 3. Vacuous-approval guard (design D2 / goal G3)

- [x] 3.1 Failing tests in `tests/sdd-runner/gate-model.test.ts` (extend `parseGateResponse` describe near line 93): (a) when an early gate was presented with `capHitFired=true`, 0 blockers, 0 assumptions, resume without checking the `T1` box → rejects with an error naming `T1`; (b) with `T1` checked → approves; (c) when `mode === 'final'` or `blockers.length > 0`, `T1` is absent and the existing protocol is unchanged. Verify: `bun test tests/sdd-runner/gate-model.test.ts` (fails)
- [x] 3.2 Extend `GateDigestInput` with `capHitFired: boolean`; `writeGateDigest` emits the `T1` ack box (under a `### Trajectory reviewed` heading) only when `mode === 'early' && blockers.length === 0 && capHitFired`; `parseGateResponse` treats `T1` as a required check in that case, plumbed through `ExpectedGateContent` (add a `requiredAck?: string` field). Verify: `bun test tests/sdd-runner/gate-model.test.ts`; `bun run typecheck`

## 4. Orchestrator wiring (design D3)

- [x] 4.1 Failing test in `tests/sdd-runner/orchestrator.test.ts`: a `runStart` whose fake-spawned reviewer+resolver cap out at round 3 with MATERIAL open produces a `gate-1.md` containing the trajectory block, the open-MATERIAL checkboxes, and the `T1` ack box; resume without checking `T1` is rejected. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 4.2 Wire `runPostReviewToGate` (`orchestrator.ts:130`) to pass `openMaterial`, `trajectory`, and `capHitFired` (`reviewResult.outcome === 'cap-hit'`) into `presentGateAt`; pass through to `GateDigestInput`. Update `runGateResume` (`orchestrator.ts:234`) to re-read `openMaterial`/`trajectory`/`capHitFired` for the re-presented gate on veto. Verify: `bun test tests/sdd-runner/orchestrator.test.ts`; `bun run typecheck`

## 5. Spec amendment (design D2 spec language)

- [x] 5.1 If `auto-sdd-pipeline` is not yet archived: add the D2 scenarios ("Cap-hit with material-only", "Vacuous approval rejected", "Open MATERIAL finding veto with redirect") to `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md` under "Objective convergence predicate" (spec:103) and "Single human gate" (spec:164). Verify: `openspec validate auto-sdd-pipeline`
- [x] 5.2 *(Fallback, only if 5.1's precondition fails)* Open a follow-on change `sdd-runner-cap-hit-spec-amendment` with the same scenarios as a delta against `openspec/specs/sdd-automation/spec.md`. Verify: `openspec validate sdd-runner-cap-hit-spec-amendment`

## 6. Docs + final verification

- [x] 6.1 Update `docs/architecture/sdd-pipeline.md` "Gate protocol" section: note the MATERIAL-only cap-hit path, the trajectory block, the open-MATERIAL checkbox+veto semantics, and the `T1` trajectory-reviewed ack. Verify: manual read of the section
- [x] 6.2 Full verification: `bun test`, `bun run typecheck`, `bun run lint`, `openspec validate sdd-runner-cap-hit-fidelity --strict`. Update any other affected `docs/architecture/*.md` pages surfaced by the run.
