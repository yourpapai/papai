<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner

The `afk-runner/` workspace is the graph-kernel re-host of the SDD pipeline: lifecycle states, transitions, and guards declared as **data** over XState v5 used purely as a reducer, with machine state derived exclusively by folding the append-only `events.ndjson`. It exists beside `sdd-runner/` (which stays frozen until a retirement change), not inside it. Planning artifacts for the whole C1–C7 effort live in `openspec/changes/afk-runner/` (proposal, design, tasks, `specs/afk-runner-kernel/spec.md`); this page describes the implemented state and the decisions future changes inherit.

## Layout

- `afk-runner/src/event-schemas.ts`, `events.ts` — substrate Tier 0, copied from sdd-runner (zod schemas, ndjson log, stamp/append/read).
- `afk-runner/src/legacy-fold.ts` — substrate Tier 1, the **frozen parity oracle** (sdd-runner's `replay.ts`). Ported test expectations are never rewritten.
- `afk-runner/src/kernel/` — `machine.ts` (setup() registry + pure `initialStep`/`step` wrapping `initialTransition`/`transition`), `interpreter.ts` (closed action vocabulary), `fold.ts` (`toKernelEvent` + deterministic fold with mapped/tolerated accounting).
- `afk-runner/src/graph/` — pipeline v0 as per-state data modules (`states/pipeline-states.ts`) composed in `pipeline.ts`.
- `afk-runner/src/cli.ts` — `bun run afk-runner:start -- <runDir>` prints the folded state summary.
- `tests/afk-runner/` — kernel/graph/parity/cli tests, plus `fixtures/real/` (10 historical runs) and `fixtures/scenarios/` (4 extracted shapes) that the golden-replay harness folds.

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

## Engine loop

Async validation cannot live in guards (guards are sync/pure). Validation is **pre-event at the edge**; the log records only validated transitions; guards are cheap sync re-checks:

```
EDGE-WORK (async, expensive)   agents · Zod checks · openspec validate · file predicates
        │ validated result → append (the only write)
        ▼
events.ndjson  (append-only, schema-versioned — the truth)
        │ every append (and on boot: whole log)
        ▼
PURE FOLD   state' = transition(machine, state, event)
        · guards = sync double-checks · returned actions → tiny interpreter
        ▼
ORCHESTRATOR LOOP — no long-lived XState actor; live edge and resume share one code path
```

The action vocabulary is closed (`emit` / `schedule`); the interpreter is the only place the graph causes effects, and replay never dispatches (assigns land in `nextSnapshot.context` and never appear in the executable action array).

## Kernel shape (corpus-grounded)

- **The machine owns all derived state.** The stage map is machine context, assigned on transitions; the parity harness compares folded `context.stages` against `legacy-fold`, making it a conformance test of the graph — any guard stricter than the corpus fails parity.
- **Exits are root-level global assigns**, not per-state transitions: legacy exit handling is position-independent, and root handlers fire from any state including finals, so out-of-place and post-final exits land in the map exactly as legacy folds them.
- **Enters are the only position-movers.** Structured `{ type: 'stage.enter', stage }` events with parameterized `isStage` guards per edge; one shared `closeThenActivate` assign; the review self-loop is corpus-real.
- **Two-layer tolerance:** unmapped event types (L0 noise, `round_close`, …) are skipped by `toKernelEvent`; mapped-but-edge-less events are native xstate no-ops. Either way the fold never errors.
- v0 edge set `start→intake→draft→review(self-loop)→decompose→atomicity→gate`, guarded `gate→completed` on `gate.answered` + map-all-done, `aborted` declared shape-only — simulation-verified over all 14 fixtures with exact parity before implementation. `gate.presented` is a mapped no-op until C4.

XState is pinned **exact `5.25.0`**: 5.32.6 regressed named-action param inference (`tsc`-visible).

## Grow-not-restore porting strategy

Neither port-as-is nor simplify-and-restore: V1's graph is the current pipeline's shape re-expressed as a graph (parity needs historical logs), so every graph-shape feature (self-loop, parked substate, cross-cutting recovery, back-edges, finals) arrives day one; afk-spike states then land as content on the proven engine. The afk spike (`reports/afk/`, gitignored reference material) is ported by **reimplementation** — importing from a non-repo path would break every other checkout. Deliberate deltas: context stays thin (artifacts live in the change folder), escalation never silent death (budget exhaustion gates), `meta` kept as data. The full afk-state → landing-change table is in `openspec/changes/afk-runner/design.md`.

## C3–C7 delivery plan and the U-ledger

Each follow-on is its own explored OpenSpec change:

| # | Change |
|---|---|
| C3 | think-half-on-graph — intake/draft/review consuming the real pipeline; full derived-state parity |
| C4 | gate-as-state — GATE substate, four setters as event sources |
| C5 | tail-on-graph — decompose/atomicity/finals/report; parity complete |
| C6 | agent-failed-recovery — retry budget, escalation gate, kill -9 resume drill |
| C7 | v1-live-proof — one real S change end-to-end → reflect, re-score the U-ledger, decide next |

Follow-ups ledger (U1–U9: team/mission spawner, child-actor execution, execution-half states, documenting+reflection, vision intake/L4 portfolio, `conflict_detected`, snapshot memo, TUI re-host, sdd-runner retirement) is re-scored after C7 — table in `openspec/changes/afk-runner/design.md`.

## Prototype relaxation window (C1–C7)

The C1–C7 window is a proof-of-concept: jscpd ignores `tests/afk-runner/fixtures/**` + ported tests; oxlint turns off the `max-lines` pair and `no-unsafe-type-assertion` for `afk-runner/**` and `no-unsafe-*` for `tests/afk-runner/**` (tsgolint cannot resolve xstate-inferred types cross-module; `tsc` is authoritative). All relaxations re-tighten at C7. Gates never relaxed: TDD write hooks on `afk-runner/src/**`, typecheck, lint otherwise.
