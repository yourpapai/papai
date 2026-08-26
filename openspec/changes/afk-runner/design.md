# afk-runner — design

## Context

Two prior systems: `sdd-runner/` (event-sourced substrate — append-only `events.ndjson` at three altitudes, replay-sufficient fold, versioned gates, autonomy ladder, budgets — but a hardcoded linear pipeline) and the afk spike at `reports/afk/` (full SDLC statechart topology with first-class failure/conflict states — but in-memory artifacts, no gates, no economics, no persistence; gitignored reference material). See proposal.md — Why. This design captures the exploration's decisions so the follow-on changes (C3–C7) inherit them without re-litigating.

Locked decisions: new workspace (`afk-runner/`); port afk's graph, reimplement its runtime on existing agent primitives; humans propose top-level vision, the system realizes it (U5 north star); V1 is bite-size changes C1–C7, each explored before its own change; after V1 is proven, reflect and re-score the follow-ups ledger.

## Goals / Non-Goals

**Goals (this change = C1–C2):** workspace + copied substrate core; a graph kernel where machine state is a pure fold over the log; a golden-replay harness proving stage-map parity on historical sdd-runner runs.

**Non-Goals:** everything in the delivery plan C3–C7 and the ledger U1–U9 (below); afk's agent runtime, event bus, blackboard, discussion engine, RAG (dissolved into substrate: the OpenSpec change folder is the blackboard, the event log is the bus); any sdd-runner behavior change.

## Substrate copy closure (C1 discovery)

The substrate modules split into tiers by import closure, and C1 takes only the read-path tiers:

- **Tier 0 (leaf, pure)**: `event-schemas.ts` (zod), `events.ts` (node stdlib + schemas).
- **Tier 1 (oracle)**: `replay.ts` — the legacy fold, depends on `events.ts` only. Copied as `legacy-fold.ts` and kept frozen as the parity oracle.
- **Tier 2 (ownership)**: `run-state.ts` (drags `review-model`, `run-index`, `run-lite`, `session-id`, crypto), `session-ledger.ts`, holder/calm-stop machinery. **Deferred to C3**: C1/C2 never own a run — they read fixture dirs and fold logs — so ownership machinery lands with the first change that starts live runs. Consequence: no `state.json` cross-check oracle in C1 (its Zod schema lives in the Tier 2 closure); `legacy-fold` is the sole oracle.

Test location follows this repo's convention (`tests/afk-runner/`, as `tests/sdd-runner/`), not colocated (that is the afk spike's convention).

## Golden corpus inventory (C1 discovery)

Runs live in `<target-workdir>/.sdd-runner/runs/<id>/`, not in the papai repo — the hoard sits across sibling worktrees (with byte-identical `.stryker-tmp` copies deduped). Ten unique real runs, no fresh sessions required:

| shape | count | events |
|---|---|---|
| completed (M×3, L×1) | 4 | 886–1923 |
| gate-pending live (M final-v1; L final-v8, 18 gate events, 8 auto-decisions) | 2 | 576, 2805 |
| aborted mid-review (M, 3 rounds in) | 1 | 769 |
| aborted early / pre-intake crash stubs | 3 | 1–35 |

Real-field gaps covered instead by scenario fixtures extracted from the 27 inline-crafting `tests/sdd-runner/` test files: S-depth path, steer directive consumption, calm-stop/resume, and `plan`/`child_spawned`/`child_done` (synthetic-marked; documented as having no runtime producer).

## Prototype relaxation policy

The C1–C7 window is a proof-of-concept: quality gates are selectively relaxed for the ported/copied material and re-tightened at the C7 reflection, deliberately earlier than U9. Concretely: jscpd ignores `tests/afk-runner/fixtures/**` and ported test files (near-identical by design — they are the oracle); ported test expectations are never rewritten. The `max-lines` / `max-lines-per-function` pair turns off for `afk-runner/**` for the same window — a safety valve against mid-spike forced splitting, not a license (current file estimates fit the defaults; the per-state module layout stays on merit). Gates that are never relaxed: TDD write hooks on new `afk-runner/src/**` files, typecheck, lint otherwise. The relaxations and their re-tightening are recorded in tasks 1.6, 2.0, and C7's scope.

## Decision: engine truth model (variant comparison)

| | A. Pure fold (log is truth) | B. Persisted XState snapshot | C. Artifacts as truth | D. A + snapshot memo |
|---|---|---|---|---|
| Crash resume | re-fold events | restore snapshot | re-derive from files | memo hit or re-fold |
| Graph evolution | soft — event schema is the contract | hard — snapshot/machine structural coupling, version-mismatch errors | soft — validators evolve | soft — mismatch ⇒ silent re-fold |
| Audit | total — every transition is a logged event | opaque snapshot internals | only what artifacts record | total (log) |
| Ephemeral state (rounds, caps, gate versions, vetoes, steer) | in events | in snapshot | **absent** — kills C alone | in events |
| Resume semantics for expensive actors | explicit re-scheduling | restoring **restarts invocations** — wrong when actors cost dollars | n/a | explicit |
| Conformance testing | golden replay of historical runs | hard | partial | golden replay |
| Perf at resume | O(log length) | O(1) | O(files) | O(1) typical |

**Decision: A now, D when measured.** Events are the write-ahead log; the machine is a projection. XState v5 supports this directly: `initialTransition(machine)` / `transition(machine, state, event)` are pure, actor-free, side-effect-free. Persisted snapshots (`getPersistedSnapshot`/`createActor({snapshot})`) are structurally coupled to the machine definition and restart invocations on restore — disqualified as truth. A memo layer (D) may later cache the fold keyed by `(event count, machine version hash)`; a mismatched memo is discarded and re-folded, so no snapshot migrations ever exist. Per-run logs (~10³ events) make the memo a follow-up (U7), not a need. Today's sdd-runner is quietly A+C hybrid (log + `deriveResumePoint` artifact heuristics); the synthesis makes A primary, C secondary for artifact-shaped facts.

## Engine loop

Async validation cannot live in guards (XState guards are sync/pure). Resolution: validation is **pre-event at the edge**; the log records only validated transitions; guards are cheap sync re-checks (defense in depth).

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

Action vocabulary stays closed (`emit` / `schedule`) so the interpreter is trivial; replay executes no actions (parity harness safety).

## C2 kernel shape (corpus-grounded decisions)

Folding all 14 C1 fixtures (10 real + 4 scenarios) before building pins the v0 graph empirically:

- **Enters are the only position-movers.** Every fixture follows linear enter/exit pairs; exits and gate events never move position. The synthetic children fixture has zero stage events — the machine stays initial, map all-pending.
- **Interstitial windows are real.** The early-gate window sits between `exit(review)` and `enter(decompose)` with no stage active; the final `gate.answered` can arrive *after* `exit(gate)`. A statechart value cannot say "nowhere active" — the map must.
- **Gate is cross-cutting in the logs, not a nested substate.** `presented` arrives mid-review and interstitially; `answered` outside gate occupancy. C2 maps `answered` only for the `gate → completed` edge; gate-as-state is C4.
- **The review self-loop is corpus-real** — a live run contains consecutive `enter(review)` events.
- **No `killed` or vetoed-assumption events exist anywhere in the corpus.** `aborted` and the veto back-edge are declared shape-only in v0; inbound edges arrive with C4/C6 event sources.
- **`round_close` is schema-valid yet legacy-unmapped** — fold tolerance must cover both unmapped types and mapped-type/no-edge no-ops.

The v0 edge set — `init→intake→draft→review(self-loop)→decompose→atomicity→gate`, plus `gate→completed` guarded on answered+map-all-done, `aborted` shape-only — was simulation-verified over all 14 fixtures before implementation: exact stage-map parity with `legacy-fold`, zero missing edges, zero anomalous enters. Only ~0.5% of corpus events are graph-mapped; the rest are tolerated noise.

xstate@5.25.0 pure-path facts (verified against the vendored dist): `transition(machine, snapshot, event)` and `initialTransition(machine)` return `[nextSnapshot, actions]` tuples; assigns land in `nextSnapshot.context` and never appear in the executable `actions` array — the closed vocabulary governs only that array, so replay discards it by not dispatching. Both tolerance layers are native: a no-edge event returns the snapshot unchanged with zero actions, and an out-of-union event type does not throw (the fold still pre-filters unmapped types for explicit accounting). The afk spike never exercised this path (its purity test scans source text; runtime used `createActor`) — C2 is the first consumer; pin `^5.25.0`.

**Decision: the machine owns all derived state.** The stage map is machine context, assigned on transitions; parity compares the folded `context.stages` against `legacy-fold`. This makes the parity harness a conformance test of the graph — any guard stricter than the corpus rejects a real transition, misses its assign, and fails parity. Rejected alternative: the machine tracks position only, with the map projected by a side-channel fold — parity would then compare two disjoint folds, and C3's full derived-state parity would live outside the machine forever. Legacy fold logic migrates into assigns: C2 takes `stages`; C3 takes depth/rounds/gate/children.

**Decision: exits are root-level global assigns, not per-state internal transitions.** Legacy exit handling is position-independent (marks the map done wherever position is). Binding `stage.exit.X` to state X makes an out-of-place exit a no-transition → missed assign → silent parity divergence. Root-level event handlers with assign-only actions kill that divergence class structurally; per-state modules own the enter edges — the topology. Verified against xstate@5.25.0: root-level handlers fire from any state *including finals*, so even a post-final exit lands in the map exactly as legacy folds it — no divergence case remains.

**Decision: structured stage events with guard-checked edges.** Graph events are `{ type: 'stage.enter', stage }` (not per-stage literal types). Each state declares an ordered transition array on `stage.enter`, one entry per successor: `{ target, guard: { type: 'isStage', params: { stage } }, actions: ['closeThenActivate'] }`. One shared named assign — close-all-active-then-activate `event.stage` — serves every enter edge, including the review self-loop (verified: re-entry re-fires it idempotently; `gate.presented` rides as a root-level mapped no-op with `actions: []`, so C3's gate-context assign lands as an action edit, not a wiring change). Per-state modules use `setup(...).createStateConfig` — present and runtime-verified in 5.25.0 — typed data modules composing into `createMachine`. Parameterized guards evaluate on the pure `transition()` path; a rejected enter returns the snapshot unchanged with zero actions. Consequence, accepted deliberately: the machine is *stricter* than legacy on out-of-discipline logs — legacy folds any `stage_enter` wherever it appears, the machine no-ops an edge-less enter — the parity harness is the alarm if such a log ever appears; the corpus proves none exists.

## Porting strategy: grow, not restore

Neither port-as-is nor simplify-and-restore. V1's graph is the **current pipeline's shape** re-expressed as a graph (parity needs historical logs), chosen so every graph-shape feature arrives day one: self-loop (review rounds), parked substate (gates), cross-cutting recovery (`agent_failed`), back-edges (veto→resolver), finals (`completed`/`aborted`). afk states then arrive as content on the proven engine:

| afk state | Lands in | Delta vs afk |
|---|---|---|
| `agent_failed` | C6 | retry **budget** → gate escalation, not die-or-retry |
| gates (absent in afk) | C4 | GATE substate; TUI / hand-edited file / deadline waiter / autonomy ladder as four event sources |
| `design`/`planning` | V1 as draft/review → decompose/atomicity | collapsed to the think-half; different split, same neighborhood |
| `research` | post-V1 small change | real state; backtrack edge from draft preserved |
| `code_review` | U3 | severity-convergence verify, not single pass |
| `in_development` | U2 | child actor per task (plan/children layer exists dormant) |
| `documenting`, `reflection` | U4 | reflection→backlog edge feeds U5 |
| `backlog` | U5 | L4 portfolio — vision intake |
| `conflict_detected` | U6 | conflict types: reviewer-vs-drafter, spec-vs-code drift |
| `cancelled` | V1 as `aborted` | terminal + explicit reopen event (no casual resurrection) |

Port diffs (deliberate changes): **context stays thin** (artifacts live in the change folder; context carries references/hashes — afk's context-as-blackboard is deleted); **escalation, never silent death** (budget exhaustion gates; no `agent.critical.failure` shortcut to final); **dot-notation events kept, log vocabulary is ours** (L2 events drive transitions; dual-accept old names during migration, then drop); **`meta` kept as data** (`roles`, `activities` per state — dormant in V1, activated by U1 without kernel changes).

Constraints on the port: afk's code is gitignored reference material — port by **reimplementation**; importing from `reports/afk/` would break every other checkout. afk's graph is small (~2k lines: 11 state configs + 294 lines of pure guards + error-transitions mixin); the concepts port, the runtime dies in favor of `opencode run` spawns (existing agent-layer primitives, copied in C1 or wired in C3+).

## Delivery plan (C1–C7 — this change admits C1–C2 only)

| # | Change | Contents |
|---|---|---|
| **C1** | afk-runner-foundation | workspace scaffold; substrate copy: event schemas, ndjson log, fold, run-dir conventions (copy, not import — sdd-runner stays frozen) |
| **C2** | graph-kernel | machine-as-data over XState v5 pure `transition()`; sync guards; closed action vocabulary + interpreter; golden-replay harness fed by real `runs/*.ndjson` fixtures; stage-map parity |
| C3 | think-half-on-graph | intake/draft/review self-loop states consuming the real pipeline; full derived-state parity |
| C4 | gate-as-state | GATE substate; four settlers as event sources; first-writer-wins claims kept |
| C5 | tail-on-graph | decompose/atomicity/finals/report; parity complete |
| C6 | agent-failed-recovery | cross-cutting state, retry budget, escalation gate; kill -9 mid-review resume drill |
| C7 | v1-live-proof | one real S change end-to-end on the graph → reflect, re-score ledger, decide next |

## Follow-ups ledger (U1–U9, re-scored after C7)

| # | Follow-up | Seeds from |
|---|---|---|
| U1 | team/mission spawner — N role agents per state entry, primary carries schema | afk `phase-runner`/`role-missions` |
| U2 | child-actor execution — DECOMPOSE plan → child machine instances | dormant `plan`/`children` layer |
| U3 | execution-half states — code review severity loop → verify/release | review-loop workspace |
| U4 | documenting + reflection states; reflection→backlog edge | afk states |
| U5 | vision intake / L4 portfolio — human writes vision, PM mission decomposes into candidate changes, admission gates; portfolio-altitude autonomy rules | OpenSpec, auto-policy |
| U6 | `conflict_detected` — reviewer-vs-drafter, spec-vs-code drift | afk state, drift checker |
| U7 | snapshot memo for the fold (D-variant cache, keyed by event-count + machine hash) | engine decision |
| U8 | TUI re-host as pure fold render | sdd TUI |
| U9 | sdd-runner retirement; cross-run budget accounting | — |

## Config-rule compliance

- **Scope model:** no chat-platform, task-instance, or config-context surface; all state is repo-local run dirs keyed by run id (same as sdd-runner today). No per-user/group/thread impact.
- **DB:** none — files only (ndjson, json sidecars), same durability approach as sdd-runner (`holder.json`, synchronous ledger writes).
- **New dependency `xstate`:** no existing stack component (AI SDK, Grammy, Zod, drizzle) provides statechart semantics; hand-rolling would reproduce `replay.ts`'s implicit machine with the same problem this change removes. XState v5's pure `transition()`/`initialTransition()` is used strictly as a reducer — no actors, no invoked services, no snapshot persistence in V1; the afk spike independently validated v5 fit. `xstate` must be added to the workspace `package.json` (and root lockfile) — knip gates unused exports.
- **Hooks/TDD:** every new `afk-runner/src/**` file is gated by the Write/Edit TDD hook (colocated test importing the module). Test-first order: fold/determinism tests before kernel; parity fixtures before interpreter wiring. Files stay under max-lines by splitting states/guards into per-state modules (mirroring afk's `states/` layout).
- **Checks:** the workspace joins root `tsgo`/lint/knip/jscpd scopes automatically (as `sdd-runner/` does); `reports/` stays tsconfig-excluded so the vendored spike never typechecks against papai rules.
