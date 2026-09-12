# agent-failed-recovery — design (C6)

## Context

C3–C5 drive runs end-to-end but every failure is crash-shaped: a `StageHaltError` thrown by draft/decompose/atomicity propagates uncaught through `runWorkBracket` — no event, no memo write, the bracket left open — and resume buys two fresh in-work attempts forever. The corpus proves the legacy counterpart: two real runs memo terminal over non-terminal folds (a `gate answered` with no outcome; a depth-null stop settled imperatively), `'failed'` has a schema entry, terminal-set membership, and a TUI row but no writer in either workspace, and `R5` sits in `AutoDecisionRuleSchema` emitted by nothing. Exploration (traced resumes on the real fixtures, throw-site reads, mode-union audit) resolved the design below; evidence references are summarized per decision.

## Goals / Non-Goals

**Goals:** typed failure taxonomy; `stage_failed` bookkeeping; per-stage retry budget with immediate under-budget re-run; escalation gate as gate mode `escalation` on the C4 stack; `R5` rung + steer answerability; operator abort (`stop` verb + `run_abort` event) with session release; memo writers for every park incl. the `failed` status; torn-tail tolerance + prefix property + resume-equivalence (the kill -9 drill, in-process); escalation crash-window recovery; five synthetic fixtures.

**Non-Goals (design-level):** terminal reopen; veto-with-redirect at escalation (declined, follow-up candidate); separate infra counter (one counter, kinds visible in gate content); auto-abort on escalation expiry (breaks the never-abort invariant; `steer abort` is the timer path); real-subprocess SIGKILL tests (hermetic I/O guard; in-process harness is equivalent by fold-truth); touching sdd-runner (the agent-layer retype lands in the afk copy only); `plan`-mode gates (U2), TUI (U8), snapshot memo (U7), gate reopen.

## Decisions

### D1 — Taxonomy: typed at three seams, bugs stay crashes

Compared: catch-all classification in the loop (can't tell a bug from infra) vs. typed errors at the throw sites. **Chosen: typed seams.** (1) `StageHaltError` gains a kind — `exhausted` (artifact strict-validation after 2 attempts) or `precondition` (tasks.md missing; retry cannot help — the resumeHint already distinguishes them textually); the throw sites are work-module copies whose *type* is extended without message edits. (2) agent-layer's schema-validation exhaustion (`agent-layer.ts:228`, plain `Error` today — a StageHalt in disguise: objective validator, twice, error fed back) is retyped `AgentValidationError extends Error`, message unchanged; no ported test asserts that message (verified). Review and intake thereby enter failure vocabulary mechanically — they share the agent layer, and the loop catch doesn't care which stage threw. Review's fail-*empty* branches (unparseable sidecar → open blocker) stay outside: quality judgments feed the round-cap economy, not the failure budget. (3) The spawn seam (afk-authored injection over `realSpawn`) throws typed `SpawnError` — "couldn't reach the agent" vs work-module bug. Everything untyped rethrows: a bug keeps refusal-alarm crash semantics — symmetric with D5's "a refusal is a work-module bug, not a run fact": **a crash is not a failure fact either; only declared exhaustion is.** Per-call watchdogs (wall-clock/inactivity, consumed in agent-layer) sit below: each timeout is one failed call; repeats surface upward as failures.

### D2 — `stage_failed`: root bookkeeping, bracket stays open

`{altitude: 'L2', type: 'stage_failed', stage, kind, reason, resumeHint?}` → kernel `{type: 'stage.failed', …}` → root handler `recordFailure` maintaining `failures: Record<stage, number>` as non-projected residue (tally/gateOutcome precedent). The stage map is **untouched** — no `stage_exit` appends: a failure is crash-shaped by design (the stage still owes work), so resume re-enters through the existing self-loops and the retry is the existing self-successor path. Legacy-fold tolerates the unknown type; historical logs contain none — parity-safe in both directions. The catch lives in `runWorkBracket` (bracket mechanics are the loop's); the frozen module copies stay frozen. Ordering inside the catch: append `stage_failed` → re-fold → `escalationOwed`? present escalation (D4) : return for bracket re-run (D3). Skipping the exit appends on catch is the one deviation from the bracket shape, and it is what keeps the map honest (the C5 tail's exit-from-`gate.awaiting` remains correct: that presentation follows *successful* work).

### D3 — Budget: per-stage consecutive, compiled constant, immediate re-run

Compared: whole-run pool (couples unrelated stages — a draft-heavy run starves the tail), per-depth table (no evidence depth predicts failure), config key (the five-key strict schema's trend is removal, and structural retry knobs are compiled constants: `PLAN_REPLAN_PASSES`, `ROUND_CAPS`). **Chosen: `STAGE_FAILURE_BUDGET = 1`, uniform compiled constant** — with 2 in-work attempts per bracket, cap 1 gives 4 total agent attempts before a human sees the gate. Under budget the loop re-runs the bracket **immediately** (pressured against park-then-resume: park-on-every-halt makes each validation hiccup a human touchpoint — the anti-afk failure mode; the fix-between-retries value moves to the escalation gate and steer). The ledger counts `exhausted` and `infra` (an unattended restart loop against a dead provider is the anti-afk wall-clock pattern; one counter, kinds visible in the gate content — a flaky provider burning quality budget is *seen* at extend time), cleared by the stage's successful exit and by escalation-extend. `precondition` escalates immediately. Enforcement is one pure function `escalationOwed(context)` — `failures[stage] ≥ cap ∧ no unanswered gate` — consulted by the loop catch and by resume derivation symmetrically, so a death between failure and presentation presents the same gate on resume.

### D4 — Escalation gate: fourth mode on the C4 stack, interstitial presentation

Compared: a sibling presentable (`escalation-<n>.md`, own settle/claims/waiter — duplicates three protocols to avoid one union widening) vs. gate mode `'escalation'` — **chosen the mode**, `'plan'` being the existing precedent for a wider-than-machinery union value. Fork points, each ~one line: schema/kernel `mode` unions; `narrowGateMode`/`SettleInput.gateMode` (escalation as a first-class value, not coerced); `owesExit` = never (interstitial like early); `appendMover` mode×outcome rows (approve/extend → `stage_enter(<failedStage>)`; abort → none, the existing mode-blind aborted edge fires); `evaluateLadder` third arm; `translateSteer` row; a slim content assembler (failure ledger, resume hint, budget math, spend — not `GateDigestInput`, which models assumptions/blockers); memo unions. Presentation copies review's cap-hit precedent: **the `gate.presented` event is the position-mover**; it appends from the failed stage's position while the map keeps that stage active (allStagesDone correctly blocks completion forever from an escalation settle). New edges: `gate.presented → gate` on intake, draft, decompose, atomicity (review's exists); awaiting `stage.enter` edges to review, atomicity, intake (draft/decompose exist as veto/approve-early movers) — the retry movers. `closeThenActivate` on re-entry transiently marks the failed stage done→active in one assign; end state correct. File namespace shared (`gate-<v>.md`, v = max-version+1 across modes) — one file-scan, one claims namespace.

### D5 — Ladder: R5 is the escalation rung; deadline inherited unchanged

`R5` is schema-legal in both workspaces and emitted by nothing — reserved for exactly this. At escalation presentation the always-logging ladder records rule `R5` when spend is over the cost ceiling or cost is unknown (R4's fail-closed shape mirrored onto the retry question; extend suppressed), else rule `none` → human. Deadline: the existing expiry path is an invariant worth keeping — conservative branches only, re-arm once, then pending; an un-answered escalation gate parks exactly like an un-answered final gate (no new zombie class), and death-by-timer is one `steer abort` away. Auto-abort-on-expiry declined (proposal Non-goals).

### D6 — Steer: extend valid at escalation; the unattended answer path

`translateSteer`'s mode table grows an escalation row: `extend` (valid — unlike final), `abort` (valid), `veto` invalid here (no veto offered). This makes the escalation gate programmatically answerable — a watchdog writes steer.md without a TUI; it is also the infrastructure an autonomous resumer (post-C7) would use.

### D7 — Operator abort: `stop` verb, `run_abort` event, mixin edge

The harm chain driving this: a crashed-and-abandoned run keeps a stale `running` memo → `allocateSessionId` refuses its slug forever. afk-runner ported only the holder half of stop-controller; the CLI has no stop verb. **Chosen: port `stop` as events.** Live run → write the calm-stop marker (the machinery's first producer; honored at the next boundary, parks `stopped`). Gate-pending → steer abort already works (no new surface). Dead/parked → append `{type: 'run_abort', reason: 'operator'}` → `aborted` final → memo terminal → slug released through the existing `TERMINAL_STATUSES` mechanism. The from-anywhere edge is a **per-state transitions mixin** (afk's `commonErrorTransitions` pattern — the cross-cutting-recovery feature C1's grow-not-restore list planned for) rather than a root-level targeted handler: keeps "movement lives in state configs" intact; the event appears in no historical log, so parity is untouched.

### D8 — Memo: every park writes; `failed` = failure-caused terminal

Escalation-park → `running` + `gate: {mode:'escalation', version}` ('plan'-precedent union widening in `PersistedRunStateSchema`/memo fields/run-index — historical memos parse unchanged). Terminal abort at an escalation gate → status **`failed`** — the dormant status finally means something: *the agent couldn't do the job* vs `aborted` = *a human chose to stop* — distinct rows for the session list and future portfolio analytics, released through TERMINAL_STATUSES, and parity-free (no historical run ever persisted it; derived in `memoFieldsOf` from the events — an answered-abort at an escalation-mode gate). Every drive exit path writes the memo (the catch is a park or a presentation, both of which write), retiring the stale-`running`-holds-slug bug by construction.

### D9 — Legacy aborted runs: tolerate; the heal already converges

Traced on the real fixtures: the gate-aborted run (`cdc4c06a`) resumes to `gate.awaiting` with an answered-no-outcome record; the foreground waiter reads the historical gate file (which still carries the operator's ABORT), settles through the seam, appends `answered{outcome:'abort'}` — C4's heal-forward — and the run converges to `aborted` with the log finally saying what the memo always said. The memo-aborted-no-gate run (`decomposition-2nd`) folds intake-active and is *correctly* resumable per fold-truth — legacy's "nothing to resume" was an imperative opinion (C5 deliberately made mid-intake resumable). Decision: **no memo reads for control flow, no log backfill from memo** (would invert the arrow of truth); terminal-ness of legacy runs lives in their gate files. C6's only obligation is not to break the heal.

### D10 — Validation: torn tail, prefix property, resume equivalence (the drill)

The latent bug: `readEvents` throws on any malformed line — a kill -9 between partial writes inside `appendFileSync`'s retry loop bricks every fold. **Policy: tolerate exactly one malformed final line** (treat as absent + warn; the write was in flight); interior malformed lines stay a hard error (corruption, not a crash window). On top: (1) **prefix property** — for every event-prefix of every fixture and scenario, the fold yields a legal state and a parked/drivable verdict without throwing; (2) **resume-equivalence** — with deterministic fake-pipeline stubs, complete a run, then resume from every prefix and assert the same terminal state and memo. A kill -9 produces a log prefix (plus, rarely, a torn tail) — the harness enumerates all of them deterministically, in-process (no hermetic-lane conflict). New windows healed: **W5** escalation files written, presented never landed → resume re-presents at the file-scan version (`owedPresentationOf` grows a second shape: final gates key on gate-stage-active; escalation keys on budget-exhausted); **W6** `stage_failed` landed, crash before presentation → same path (files absent → fresh render); **W7** escalation answered, mover never landed → `owedMoverOf` escalation rows, target = the still-active failed stage (derivable from the map).

### D11 — Corpus: five synthetic scenarios

Per the scenario convention (`-synthetic`, README row, inventory parity): `escalation-approve-cycle-synthetic`, `escalation-extend-cycle-synthetic`, `escalation-abort-synthetic` (terminal `failed` shape), `precondition-escalation-synthetic`, `under-budget-retry-synthetic`. Red seed: the approve fixture's mover `stage_enter(<stage>)` from `gate.awaiting` before the awaiting edges land (boundary refusal, the C5 D9 pattern).

## Risks / Trade-offs

- [Mixed kinds in one counter (infra can burn quality budget)] → deliberate: the escalation content shows kinds per failure; separate columns wait for C7 evidence (declined in proposal).
- [Immediate re-run burns budget while the operator sleeps] → bounded by construction: cap 1 → at most one unattended retry, then the gate; every further attempt is human-sanctioned (approve/extend) or nothing.
- [Bracket-left-open is a new log shape] → identical to a crashed bracket (self-loop resume attested); five fixtures pin it in the corpus.
- [agent-layer retype touches a copy] → subclass with message preserved; ported tests verified message-agnostic; TDD hooks gate the edit.
- [Mode-union widening spreads across ~8 fork points] → enumerated and one-line each; `'plan'` proves the pattern; historical memos and logs parse unchanged.
- [Prefix harness over every fixture is O(events) folds] → corpus ~10⁴ events total; sub-second budget in tests.

## Migration Plan

TDD order (Write/Edit hooks gate every new `afk-runner/src/**` file; tests in `tests/afk-runner/`):

1. **Taxonomy face**: typed `SpawnError` (seam wrapper), `AgentValidationError` retype, `StageHaltError` kind — failing tests per seam first.
2. **Kernel face**: `stage_failed` schema + fold mapping + root handler + failures ledger + clear-on-exit (graph/kernel tests); red seed fixture.
3. **Edges face**: presented edges ×4, awaiting enter-edges ×3, `run_abort` mixin — graph tests + full parity (historical fixtures unchanged).
4. **Loop face**: catch in `runWorkBracket` — append, `escalationOwed`, re-run vs present; under-budget integration drill.
5. **Escalation face**: content assembler + render/parse, settle mover rows, `R5` ladder arm, expiry no-op inheritance, steer row; approve/extend/abort goldens.
6. **Operator face**: `stop` verb (marker / `run_abort`); slug-release test.
7. **Memo face**: escalation gate record, `failed` projection, every-park-writes; memo-parity suite stays green.
8. **Validation face**: torn-tail policy (red seed — the latent bug), prefix property, resume-equivalence; W5–W7 recovery drills.
9. **Corpus face**: five fixtures + README/inventory rows.
10. Full `bun test`, typecheck, lint, knip; docs update (`docs/architecture/afk-runner.md` C6 row).

Rollback: additive beside C5 behavior; the graph edits are new-logs-only and guarded by parity over unchanged historical logs.

## Config-rule compliance

No chat-platform, task-instance, or config-context surface; all state is repo-local run dirs (inherited). No DB, no new dependencies. No new tool surface — capability/tool-prefs untouched. Budget is a compiled constant (no config key). Every new `afk-runner/src/**` file enters the Write/Edit TDD hook pipeline; the faces above are the test-first order. The prototype relaxation window covers the work copies as C3–C5's; re-tightening stays pinned to C7.

## Open Questions

None — the exploration resolved the design-shaping unknowns as D1–D11; micro-decisions pinned: `STAGE_FAILURE_BUDGET = 1`, shared `gate-<v>.md` namespace, event names `stage_failed`/`run_abort`, mixin (not root-targeted) abort edge.
