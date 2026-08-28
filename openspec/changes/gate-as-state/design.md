# gate-as-state — design (C4)

## Context

C3 left afk-runner driving live think-half runs that park `gate-pending` at cap-hit with no way to settle: the four producers (TUI, hand-edited file, deadline waiter, autonomy ladder) live in frozen sdd-runner orchestrator code, and the gate is context-only (`GateRecord` in kernel context; parking derived by review's outcome map sniffing `context.gate`). The corpus pins the contract this design must honor — findings verified against the golden fixtures during exploration:

1. **`gate answered` never moves position.** Every positional change is a subsequent event the settle tail writes: `round_open` (extend), `stage_enter(decompose)` (approve-early), `stage_enter(draft)` (veto, unattested), nothing (abort). A completed run's log *ends* with the lone answered event.
2. **Re-answers are corpus-real.** The marathon fixture holds `answered`×3 + `round_open`×3 for one version (crash-resume cycles on the extend path); the gate record is never cleared on extend.
3. **Presentations bracket by mode.** Early: interstitial after `stage_exit(review)`, no stage events. Final: inside the `gate` stage bracket, answer arriving after `stage_exit(gate)` — the existing `gate→completed` edge already serves it.
4. **The ladder always logs.** `auto_decision` is appended at every presentation, `rule=none` included; older runs say `decision:"preview"`, newer `decision:"gate"` for the same hand-to-human outcome.
5. **Abort is attested as an empty tail.** The aborted fixture ends `presented early v1 → auto_decision R4 → answered final v1` — nothing follows; no abort event type exists at L2 anywhere (`killed.cause` is L1 agent vocabulary, C6's).
6. **Legacy never logged deadlines.** `gateDeadlineAt` lived in state.json only; `AUTONOMY_DEFAULTS` configures none.

## Goals / Non-Goals

**Goals:** gate awaiting as machine position; settlement by four producers through one validated seam; outcome-keyed continuation incl. veto and abort; foreground waiter; ladder as log-visible producer; deadline as thin log-truth; the latent reader fix; owed-mover resume.

**Non-Goals (design-level):** gate reopen (D9 of sdd-runner — deferred; `completed` stays terminal); the gate-stage final-presentation *work module* (C5 — C4 lands the substate wiring, fixture-exercised); interactive TUI rendering (U8 — the seam accepts answer objects); failure/abort event vocabulary beyond the outcome field (C6); `plan`-mode gates (dormant); snapshot memo (U7).

## Decisions

### D1 — GATE substate; movers stay legacy events (parity-free topology)

Three shapes were compared: context-only settlement (no topology; parking stays a context sniff), literal substate, and hybrid (substate for the final gate only). **Chosen: literal substate.** Parity compares `ReplayState`-shaped context, never the machine `.value` — the graph may move on gate events without touching the map — and the corpus (fact 1) already names the movers. `gate.presented` moves position into `gate.awaiting` from review (early, interstitial) — a new edge that carries **no stage-map assign** (gate events never touch the map; the mechanism differs from `closeThenActivate` deliberately). The `gate` stage becomes compound with `awaiting` as its initial child, so the final gate enters awaiting via the existing `stage.enter(gate)` edge. Exits key on mover events: `round.open` → review (carrying the shadowed `openRound` assign), `stage.enter(decompose)` → decompose, `stage.enter(draft)` → draft, `gate.answered`+all-done → completed (existing edge), `gate.answered`+`outcome=abort` → aborted (new logs only). Re-presentation is a self-transition with `reenter: true` — the one place C3-D3's rejected re-enter is right (fresh version = genuinely fresh awaiting; there is no entry-carried derived state to double-apply on this state). Per-state edges re-declare the root assigns they shadow — the pattern the v0 `gate` state already uses. What the substate buys over context-only: awaiting is a *position* (status/U8 render from the snapshot alone), parking becomes positional (review's outcome map stops sniffing gate context), abort gains an edge, and reopen has a future target. Rejected: context-only leaves the sniff in place and abort topology-impossible; hybrid splits one lifecycle across two mechanisms.

### D2 — Additive `outcome` on answered; mode stays byte-faithful

New `gate answered` events carry optional `outcome: approve | veto | extend | abort`. Historical logs derive structurally (what follows) and fold to identical context; a historical answered-with-nothing-after parks awaiting settlement rather than erroring. The legacy `mode` field keeps its oddities (approve-through-early and abort both emit `mode:"final"`) — `mode` is legacy-faithful noise, `outcome` is the new truth; the fold maps both. The outcome field closes the answered↔mover crash window and enables owed-mover resume (D7) and historical heal (next settlement of an old answered log appends an explicit-outcome event — the dual-accept-then-drop migration pattern). Rejected alternative: moving on the answer itself — front-runs the mover events the corpus records and duplicates what `round_open`/`stage_enter` already carry.

### D3 — Waiter hosting: run-level continuation, not registry work, not `schedule`

The drive loop's bracket is stage-shaped — it appends `stage_enter`/`stage_exit` around any position declaring work, and `awaiting` must never emit stage events. Options: (B) awaiting declares waiter work via the registry, requiring a `bracket: 'silent'` loop-contract extension for one consumer; (C) the `schedule` action fires the watcher on the presented-append's transition — but replay never dispatches actions (C3-D3's own finding), so crash-restart needs a resume-path mechanism anyway; (D) a run-level post-park continuation in `run.ts`. **Chosen: D.** After `drive` parks gate-pending, the process stays alive in a foreground waiter (1s poll: gate file, steer file, external settlement), settles through the seam, re-evaluates the parked reason, and re-drives or exits — mechanically sdd-runner's `gate resume` flow (settle → continue), with crash-restart being the resume path and the holder bracket naturally covering the waiting process. `schedule` stays dormant; D subsumes it for this consumer (vocabulary, not obligation). Stop at gate-pending is a no-op (ported as-is).

### D4 — Deadline as log-truth, thin and config-gated

`gate presented` grows optional `deadlineAt` (absolute stamp computed at presentation; captures overrides), plus one small additive re-arm event. Rejected: memo fields — C3-D6's own contract makes the memo deletable with zero behavior change, which a behavioral deadline violates; claim-file truth — claims are cross-process arbitration (D10), not truth. Legacy never logged deadlines (fact 6), so the additive field has zero parity exposure. The operator does not use deadlines: expiry machinery ports **thin** — exclusive claim, conservative-ladder re-run (approve/extend only), re-arm at most once, never auto-abort — config-gated and minimally exercised. The stamp lands regardless (cheap; U8's fold-render wants it).

### D5 — One settle seam; four producers; claims kept

Everything converges on one seam: answers → render → parse-back → integrity check (hashes sidecar) → append through the boundary. sdd-runner already works this way — even the ladder builds `GateAnswers` and self-check-parses (`renderAutoApproveAnswers`) — so the seam is named, not invented. Producers: TUI-style answer objects (the interactive renderer itself is U8), hand-edited gate file (polled by the waiter, 3-tick stability guard, looks-answered check), deadline expiry (D4), and the ladder (D6). Steer is a run-level channel, not a fifth producer: `steer.md` landing at a parked gate is translated to its answer equivalent by the waiter (extend-at-final rejected with warning — ported as-is); mid-round steer stays C3's review-work domain. First-writer-wins claims stay edge IPC, never truth: `gate-<n>.settle-claim` exclusive-create, loser rejected naming the winner, the legacy `expiry-claim` name counting as a claim.

### D6 — Ladder as producer; fix the reader it exposes

The ladder (R1 approve / R2 extend / R3 accept-items / R4 fail-closed, never-cut pre-checks) ports as the presentation-time producer: evaluated at every presentation, always appending `auto_decision` — `rule=none` included (fact 4; the fold already tolerates the `preview`/`gate` vocabulary drift) — with R1 and R2 settling through the seam. The auto-extend allowance derives from folded `auto_decision` records (C3-D6). The producers expose a latent C3 bug that becomes this change's first failing test: the review outcome reader returns cap-hit whenever `context.gate !== null` — *including answered gates* (fact 2: extend never clears the record), so an extended round would park immediately without running. Fix: only an **unanswered** gate parks cap-hit; the marathon fixture truncated at its three answered points is the golden regression. A deliberate delta is recorded here: after an extend settle, afk-runner appends the review re-entry (`stage_enter(review)`) that legacy omitted — the map re-activates review during extended rounds (legacy's map sat stale); fold-tolerant and parity-safe (parity is per-log), but a decision, not drift.

### D7 — Owed-mover resume and historical heal

Resume folds the log and asks: answered with explicit outcome, mover missing? Append the owed mover (`round_open` for extend; `stage_enter(decompose)` for approve — parking awaiting-tail until C5; nothing for abort, already terminal) and continue. Answered without outcome (historical): park awaiting settlement; the next settlement re-reads the gate file and appends an explicit-outcome event — history heals forward without rewriting. The crash window between answer and mover, ambiguous in legacy, is self-describing in new logs.

### D8 — Veto lands synthetic; C6 line drawn

No veto events exist anywhere in the corpus. The veto path (answer with vetoes/redirects → `stage_enter(draft)` mover → veto-updater revision round) lands with a synthetic-marked scenario fixture (the children-plan precedent) and the veto-updater work module ported. Boundary with C6: gate answers are *decisions* (C4); `killed`/stall/timeout are *infrastructure death* (C6) — `killed.cause` and any failure-event vocabulary are untouched, per C3-D5's no-front-running stance.

## Risks / Trade-offs

- [Compound positions break the drive loop's string-position assumption (`positionOf` stringifies compound values)] → flatten to a dot-path (or key `workFor` accordingly) as an explicit task with graph-shape tests; the only compound state in v1 is `gate.awaiting`.
- [Per-state edges shadow root assigns — missed duplication silently drops bookkeeping] → the shadowed-assign pattern is established (v0 `gate` state) and parity/graph-shape tests cover every new edge; no new mechanism.
- [Foreground waiter blocks the CLI indefinitely] → accepted deliberately (debug visibility first, autonomy later); external settlement and calm-stop interplay are no-ops; Ctrl-C is the exit.
- [Thin deadline machinery is lightly exercised] → config-gated, additive schema, minimal tests; polish is explicitly declined.
- [Re-settle idempotence depends on fold tolerance, not dedup] → corpus-proven (fact 2); the marathon fixture is the regression.
- [Owed-mover resume writes events a legacy log never had] → only for new explicit-outcome logs (self-describing) and heal-on-settle (append-only, never rewrite); historical folds stay byte-identical.

## Migration Plan

TDD order (write hooks gate every new `afk-runner/src/**` file; tests in `tests/afk-runner/`):

1. **Reader face**: failing outcome tests over the marathon fixture truncated at its answered points → unanswered-only cap-hit guard → green.
2. **Kernel face**: `outcome`/`deadlineAt` schema + fold mapping + context; full parity over all fixtures unchanged.
3. **Graph face**: `gate` compound with `awaiting`, mover/abort edges, compound-position handling in the drive loop; graph-shape tests + full parity + fold-tolerance of re-answers.
4. **Seam face**: gate rendering copies (digest/model/answers/extract/hash sidecar); review's cap-hit presentation upgraded to full presentation (gate md + hashes + presented event); claims.
5. **Waiter face**: run-level foreground continuation, stability guard, steer translation, external-settle exit, stop no-op.
6. **Ladder face**: auto-policy copy, presentation-time prelude, R1/R2 settle paths, always-log behavior.
7. **Resume face**: owed-mover recovery, historical heal, resume drills.
8. **Veto face**: synthetic scenario fixture, veto-updater port, draft re-entry.
9. **Deadline face**: stamp, expiry claim, conservative re-run, re-arm-once (thin, config-gated).
10. Full `bun test`, typecheck, lint, knip; docs update (`docs/architecture/afk-runner.md` C4 row; `schedule`-dormant note).

Rollback: additive beside C3 behavior; reverting restores park-only runs.

## Config-rule compliance

- No chat-platform, task-instance, or config-context surface; all state is repo-local run dirs (inherited). No DB, no new dependencies (xstate already pinned). Every new `afk-runner/src/**` file enters the Write/Edit TDD hook pipeline; the faces above are the test-first order. The prototype relaxation window (jscpd/oxlint scoped relaxations) covers the copied gate modules as it covered C3's work copies; re-tightening stays pinned to C7.

## Open Questions

None — the exploration resolved the unknowns (substate shape, waiter hosting, deadline truth, outcome visibility, steer taxonomy, C4/C5 boundary, C6 line) as D1–D8 above.
