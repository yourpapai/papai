<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner

The `afk-runner/` workspace is the graph-kernel re-host of the SDD pipeline: lifecycle states, transitions, and guards declared as **data** over XState v5 used purely as a reducer, with machine state derived exclusively by folding the append-only `events.ndjson`. Since C3 the graph **drives live think-half runs** (intake → draft → review) through a generic, stage-agnostic loop — resume is the same loop re-folding the log. It exists beside `sdd-runner/` (which stays frozen until a retirement change), not inside it; work modules are copies, never imports. Planning artifacts for the whole C1–C7 effort live in `openspec/changes/afk-runner/` (proposal, design, tasks, `specs/afk-runner-kernel/spec.md`); C3's decisions live in `openspec/changes/think-half-on-graph/`; this page describes the implemented state and the decisions future changes inherit.

## Layout

- `afk-runner/src/event-schemas.ts`, `events.ts` — substrate Tier 0, copied from sdd-runner (zod schemas, ndjson log, stamp/append/read).
- `afk-runner/src/legacy-fold.ts` — substrate Tier 1, the **frozen parity oracle** (sdd-runner's `replay.ts`). Ported test expectations are never rewritten.
- `afk-runner/src/kernel/` — `machine.ts` (setup() registry + pure `initialStep`/`step` wrapping `initialTransition`/`transition`, full derived-state context with the root-level bookkeeping vocabulary `kernelRootHandlers`, scratch tally included), `interpreter.ts` (closed action vocabulary), `fold.ts` (`toKernelEvent` + deterministic fold with mapped/tolerated accounting; `foldLogOrInitial` tolerates a not-yet-created log).
- `afk-runner/src/graph/` — pipeline v0 as per-state data modules (`states/pipeline-states.ts`) composed in `pipeline.ts`; `pipeline-work.ts` composes the per-state **work modules** (work kind + outcome→successor data, context-pure outcome readers) into the `workFor` registry the loop consumes.
- `afk-runner/src/drive/` — `loop.ts` (the generic successor-or-park drive loop; names no stage), `boundary.ts` (append boundary: pure transition probe, refusal throws), `resume.ts` (resume derivation as pure functions of folded context + session ledger).
- `afk-runner/src/work/` — think-half work re-hosted as edge work (copies from sdd-runner): intake, draft (+ `stage-halt.ts`), review (`review.ts` wrapper around the review-loop copy: re-entry from context+ledger, cap-hit appends the presented early gate), review-loop, review-model, steer, materialize (+ `digest-format.ts`).
- `afk-runner/src/` substrate copies — `config.ts`, `openspec-driver.ts`, `agent-layer.ts`, `agent-reporter.ts` (spawn seam over review-loop's `runAgent`), `session-id.ts`, `session-ledger.ts`, `run-state.ts` (slimmed: deadline fields → C4, plan/children → C5; `ROUND_CAPS` re-homed here), `run-index.ts`, `run-lite.ts`, `stop-controller.ts`.
- `afk-runner/src/run.ts` — the orchestrator replacement: start/resume/status over the drive loop, holder lifecycle, the derived `state.json` memo.
- `afk-runner/src/cli.ts` — `start <taskFile>`, `status <runId>`, `resume <runId>`; a bare run-dir arg keeps printing the C1 fold summary.
- `tests/afk-runner/` — kernel/graph/parity/drive/cli/integration tests, `fixtures/fake-pipeline.ts` (stubbed-agent harness), plus `fixtures/real/` (10 historical runs) and `fixtures/scenarios/` (4 extracted shapes) that the golden-replay harness folds.

## Engine truth model (decision A→D)

Four variants were compared for where authoritative run state lives:

| | A. Pure fold | B. Persisted snapshot | C. Artifacts as truth | D. A + snapshot memo |
|---|---|---|---|---|
| Crash resume | re-fold events | restore snapshot | re-derive from files | memo hit or re-fold |
| Graph evolution | soft (event schema is the contract) | hard (structural coupling) | soft | soft — mismatch ⇒ re-fold |
| Audit | total | opaque internals | only what artifacts record | total |
| Ephemeral state | in events | in snapshot | **absent** | in events |
| Conformance testing | golden replay | hard | partial | golden replay |

**Decision: A now, D when measured.** The log is the write-ahead log; the machine is a projection. XState v5's `transition()`/`initialTransition()` are pure and actor-free — used strictly as a reducer (no actors, no invoked services, no snapshot persistence in V1). Persisted snapshots are structurally coupled to the machine and restart invocations on restore — disqualified as truth. A memo layer (D) is a follow-up (U7) keyed by `(event count, machine version hash)`; a mismatched memo is discarded and re-folded, so no snapshot migrations ever exist.

## Engine loop (live since C3)

Async validation cannot live in guards (guards are sync/pure). Validation is **pre-event at the edge**; the log records only validated transitions; guards are cheap sync re-checks:

```
DRIVE LOOP (generic, stage-agnostic) — fold → workFor(position) → outcome→successor data
        · bracket: append enter (boundary-validated) · run work · append exit
        · successor-or-park: enter the successor iff it declares work, else park
        · parked reasons are data: awaiting-tail · gate-pending · stopped
EDGE-WORK (async, expensive)   agents · Zod checks · openspec validate · file predicates
        │ validated result → append (the only write, through the append boundary)
        ▼
events.ndjson  (append-only, schema-versioned — the truth; state.json is a derived memo)
        │ every append (and on boot: whole log)
        ▼
PURE FOLD   state' = transition(machine, state, event)
        · root-level target-less assigns own all bookkeeping (depth, rounds, tally,
          gate, auto-decisions, children); enters are the only position-movers
        ▼
RESUME = the same loop: re-fold, parked reason from context, re-entry via the
         graph's own self-loop, continuation from the session ledger
```

The action vocabulary is closed (`emit` / `schedule`); the interpreter is the only place the graph causes effects, and replay never dispatches (assigns land in `nextSnapshot.context` and never appear in the executable action array). The `schedule` action stays dormant — its natural first consumer is C4's gate watchers.

### Append boundary and refusal semantics (D5)

Every `stage_enter` append is probed with the pure `transition()`: a snapshot returned **identical by reference with zero executable actions** means no edge fired — nothing appends and the refusal throws at the edge, naming the refused event. The log records only validated transitions; a refusal is a work-module bug, not a run fact (failure-event vocabulary is C6's to design). Non-enter events are root-level bookkeeping and append directly.

## Kernel shape (corpus-grounded)

- **The machine owns all derived state.** The full legacy `ReplayState` — stage map, depth, round, per-round digests with last verdict, gate record, auto-decision records, children — is machine context; the parity harness compares every field against `legacy-fold` over all 14 fixtures with bisect-to-first-divergent-event, making it a conformance test of the graph — any guard stricter than the corpus fails parity. The finding→convergence tally lives in context as a scratch accumulator (the only non-projected field besides nothing else; parity compares the `ReplayState`-shaped fields, never the residue).
- **Root-level target-less handlers own all bookkeeping** (`kernelRootHandlers`): legacy handling is position-independent, and root handlers fire from any state including finals, so out-of-place and post-final events land exactly as legacy folds them. `gate.answered` is answered by both the gate-state edge and the root fallback, mirroring legacy's position-independent answer.
- **Enters are the only position-movers.** Structured `{ type: 'stage.enter', stage }` events with parameterized `isStage` guards per edge; one shared `closeThenActivate` assign; the review self-loop is corpus-real and is the resume re-entry path.
- **Two-layer tolerance:** unmapped event types (L0 noise, …) are skipped by `toKernelEvent`; mapped-but-edge-less events are native xstate no-ops. Either way the fold never errors.
- v0 edge set `start→intake→draft→review(self-loop)→decompose→atomicity→gate`, guarded `gate→completed` on `gate.answered` + map-all-done, `aborted` declared shape-only — simulation-verified over all 14 fixtures with exact parity before implementation. `gate.presented` records into context; its settlement producers are C4.
- XState is pinned **exact `5.25.0`**: 5.32.6 regressed named-action param inference (`tsc`-visible).

## Grow-not-restore porting strategy

Neither port-as-is nor simplify-and-restore: V1's graph is the current pipeline's shape re-expressed as a graph (parity needs historical logs), so every graph-shape feature (self-loop, parked substate, cross-cutting recovery, back-edges, finals) arrives day one; afk-spike states then land as content on the proven engine. The afk spike (`reports/afk/`, gitignored reference material) is ported by **reimplementation** — importing from a non-repo path would break every other checkout. Deliberate deltas: context stays thin (artifacts live in the change folder), escalation never silent death (budget exhaustion gates), `meta` kept as data. The full afk-state → landing-change table is in `openspec/changes/afk-runner/design.md`.

## C3–C7 delivery plan and the U-ledger

Each follow-on is its own explored OpenSpec change:

| # | Change | Status |
|---|---|---|
| C3 | think-half-on-graph — drive loop, work re-host, full derived-state parity, resume by replay, memo demotion | **delivered** — decisions D1–D7 in `openspec/changes/think-half-on-graph/design.md` are the pointers C4–C7 inherit (driver protocol, rounds-as-context, registry scheduling, root-assign migration, refusal semantics, memo policy, copy closure) |
| C4 | gate-as-state — GATE substate, four setters as event sources | next |
| C5 | tail-on-graph — decompose/atomicity/finals/report; parity complete | planned |
| C6 | agent-failed-recovery — retry budget, escalation gate, kill -9 resume drill | planned |
| C7 | v1-live-proof — one real S change end-to-end → reflect, re-score the U-ledger, decide next | planned |

Follow-ups ledger (U1–U9: team/mission spawner, child-actor execution, execution-half states, documenting+reflection, vision intake/L4 portfolio, `conflict_detected`, snapshot memo, TUI re-host, sdd-runner retirement) is re-scored after C7 — table in `openspec/changes/afk-runner/design.md`.

## Prototype relaxation window (C1–C7)

The C1–C7 window is a proof-of-concept: jscpd ignores `tests/afk-runner/fixtures/**` + ported tests; oxlint turns off the `max-lines` pair and `no-unsafe-type-assertion` for `afk-runner/**` and `no-unsafe-*` for `tests/afk-runner/**` (tsgolint cannot resolve xstate-inferred types cross-module; `tsc` is authoritative). All relaxations re-tighten at C7. Gates never relaxed: TDD write hooks on `afk-runner/src/**`, typecheck, lint otherwise.
