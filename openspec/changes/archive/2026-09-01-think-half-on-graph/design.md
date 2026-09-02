# think-half-on-graph — design (C3)

## Context

C2 left afk-runner as a proven read-only engine: v0 graph (edges on `stage.enter` only, root-level assigns for exits), kernel fold with two-layer tolerance, stage-map parity over 14 fixtures, closed action vocabulary with a dormant `schedule`. Sequencing knowledge lives only in sdd-runner's `runStart`/`runPlanningStages` (orchestrator.ts) — imperative code with a 5-line emit decorator (`stage-machine.ts`). See proposal.md — Why. This design records C3's decisions so C4–C7 inherit them without re-litigating.

Grounding facts verified against the vendored xstate 5.25.0 dist during exploration (probe scripts, not test-suite claims):

1. `initialTransition` **does** surface the initial state's `entry` actions in the executable array.
2. A cross-state enter surfaces the target's `entry` actions and runs its `entry` assigns.
3. A **self-loop re-entry does not re-fire `entry` actions or assigns** (v5 default: self-transitions do not re-enter; `reenter: true` would be required).
4. A guard-rejected or edge-less event returns the snapshot **identical by reference** with zero executable actions.
5. Root-level target-less handlers fire from any state including finals (reconfirmed).

## Goals / Non-Goals

**Goals:** the drive loop (generic, stage-agnostic); think-half work re-hosted as edge work; full `ReplayState` parity in machine context; append boundary; think-half resume by replay; `state.json` demoted to memo.

**Non-Goals (design-level):** failure-event vocabulary (`run.error`, abort events) — C6 designs it with real requirements; gate settlement; tail execution; entry-action scheduling (rejected below); U7 memo; per-round machine granularity (rounds are context, never position).

## Decisions

### D1 — Driver protocol: edge-decides, graph-verifies

Three protocols were compared. **P0 mirror** (re-host `runPlanningStages`, events as decoration) fails the kernel spec's "new state without control-flow edits" scenario — rejected. **P2 graph-decides** (domain events trigger action-only transitions that emit stage events via the interpreter) is more declarative but requires every mover to reproduce legacy event timing exactly for parity, adds a quiescence pump for chained appends, and buys nothing over P1 for a graph whose only branch is review's converged/cap-hit — rejected. **P1 (chosen):** edges stay on `stage.enter` (exactly what C2 proved over the corpus); work modules produce validated domain events; the successor choice is data co-located with each state module; the append boundary validates legality against the graph. Async policy (convergence, caps, steer consumption, stop markers) stays at the edge; sync guards are double-checks — the engine-loop decision unchanged.

### D2 — Rounds are context, not position; successor-or-park

The corpus's consecutive `enter(review)` events come from calm-stop/resume re-entry, not per-round movement — sdd-runner brackets the *whole* loop in one enter/exit pair (orchestrator.ts:272). So the review recursion (review-loop.ts:259) stays inside the work module; the machine sees rounds only as context (`round`, `perRound`, `lastVerdict`). After a state's work completes and its exit is appended, the loop applies: successor = outcome map of the state module; **enter it iff it declares work, else park**. This covers the whole pipeline: the only branch is review's outcome, and cap-hit means no movement (early-gate interstitial window). C5 lands decompose by adding a state module *with* work; the identical review completion then auto-continues. Parked-after-review is the machine in `review` with the map showing done — position literally does not move, matching legacy folds.

### D3 — Scheduling by registry query, not entry actions

Facts 1–3 settle it: entry-action scheduling works at boot and cross-state, but the self-loop re-entry (the resume path) would silently not re-schedule — an asymmetry that would bite exactly where resume matters. `reenter: true` would fix it but re-runs entry assigns on historical re-entries, double-applying any entry-carried derived state. Chosen: the loop asks `workFor(activeState)` — a data accessor exported by each state module (work kind + outcome→successor map), the same accessor for boot, live, and resume. One scheduling path, zero xstate-behavior dependence. The `schedule` action stays in the vocabulary (unused is fine — it is vocabulary, not obligation; C4's gate watchers are its natural first consumer).

### D4 — Full derived-state migration via root-level target-less assigns

`toKernelEvent` grows to map `depth`, `round_open/close`, `finding`, `convergence`, `gate.*`, `auto_decision`, `plan`, `child_spawned/child_done`; each lands as a root-level `{ on: { <event>: { actions: [assign] } } }` handler — target-less, fires from any state, position unchanged (the mechanism already proven for `stage.exit`). Symmetry preserved: **enters are per-state topology; everything else is root-level bookkeeping**. The legacy tally closure (`pending: Map` in legacy-fold.ts) moves into context as a scratch accumulator (`finding` increments, `convergence` flushes to `perRound` and clears) — context's first non-projected field, still a pure function of the ordered log; parity compares the `ReplayState`-shaped fields, never the residue (legacy never exposed it either). `autoDecisions` migrates now (fold-side completeness); its producer (auto-policy) is C4. "Full parity" means fold-side: every `ReplayState` field is machine context before C3 ends.

### D5 — Append boundary: transition probe, refusal throws

Legality check = run the pure `transition()` with the candidate event; if it returns the snapshot identical by reference and zero actions (fact 4), no edge fired → refuse. This covers all guard kinds, not just `isStage`, and needs no config walking. **Refusal semantics: throw at the edge.** The log records only validated transitions — a refusal is a work-module bug, not a run fact; inventing a `run.error` event now would front-run C6's failure-vocabulary design (retry budgets, attempt counters) and write a fact no legacy run has; run-level failure is process state (holder absence, memo status), not log state. Crash-resume safety: the log stays at the last valid event; re-fold lands at the last valid position; the bug reproduces deterministically for the operator.

### D6 — `state.json` demoted to derived memo; resume is a read

Nothing reads `state.json` for control flow. Session-id allocation and run listing re-fold logs (~10³ events — irrelevant) or read the memo opportunistically; the memo may be deleted with zero behavior change (spec scenario). `autoExtendsUsed` derives from context `autoDecisions`; deadline fields defer to C4 with their producers; holder/stop-marker files remain edge IPC (locking/signals), never truth. Resume decision re-hosts as a pure function of folded context + session ledger: stage from position, round/entry from `round`+`perRound`, continuation from the ledger's recorded session. Parked reporting vocabulary: `halted: 'awaiting-tail' | 'gate-pending' | 'stopped'` — data, not errors; mid-think-half calm-stop resumes into the interrupted round (the corpus-real self-loop).

### D7 — Copy closure (copy-not-import invariant)

Copied: intake/draft/review-loop work modules + review-model, steer, materialize; agent-layer (spawn seam); slimmed Tier 2 (session-id allocation, session ledger, run-dir conventions, stop-controller/holder). **Not copied:** orchestrator.ts (replaced by the loop — the point of the change), gate machinery (C4), post-review tail/decompose/plan (C5), TUI (U8). sdd-runner stays untouched until U9; imports from it are forbidden so its retirement cannot break afk-runner. jscpd's prototype ignore extends to ported src modules (near-identical by design), re-tightening at C7 as already recorded.

## Risks / Trade-offs

- [Work modules assume they own the bracket (`machine.runStage` inside orchestrator code) → parameterization cost discovered when porting tests] → budgeted as first-week implementation discovery; the loop-owned bracket is mechanically identical (enter, work, exit), so ported test expectations stay unchanged.
- [Context scratch accumulator grows unboundedly for never-converging rounds] → bounded by round cap; identical residue semantics to legacy's Map; U7 memo can truncate if ever measured.
- [O(n) re-fold per append → O(n²) per run] → ~10⁶ ops at current log sizes; U7 is the measured fix.
- [Registry query bypasses the action interpreter for scheduling] → accepted: the interpreter remains the only *effect* site for graph-declared actions; the registry is data the loop reads, symmetric with the kernel spec's "machine as data" requirement.
- [Self-loop map-invisibility (C2 finding) extends to full-context parity] → perRound/round fields give parity new sensitivity there; graph-shape tests retain topology coverage for the self-loop.

## Migration Plan

TDD order (write hooks gate every new `afk-runner/src/**` file; tests in `tests/afk-runner/`):

1. Face 1 (fold-side, corpus-proven): failing parity tests over all fixtures comparing full `ReplayState` → root-level assigns + scratch context → green.
2. Loop: failing tests with a stub graph + fake work (bracket, successor-or-park, append refusal, park reporting) → drive loop + boundary → green.
3. Work re-host: port think-half module tests (fake agents, as `tests/sdd-runner/` does) → copies land → green.
4. Integration: one live-shaped run with stubbed agents end-to-end (start → park), resume drill (kill between rounds).
5. Full `bun test`, typecheck, lint, knip; docs update (`docs/architecture/afk-runner.md` C3 row).

Rollback: afk-runner is additive beside frozen sdd-runner; reverting the change reverts the workspace to the C2 read-only engine.

## Open Questions

None — the three exploration unknowns (entry-action behavior, refusal semantics, parked-reporting scope) are resolved above as D3, D5, D6.
