## Why

C5 left failure log-invisible: a `StageHaltError` propagates uncaught — no event lands, no memo is written (a stale `running` state.json holds the session slug forever), and every resume buys two fresh in-work attempts, unbounded. Budget exhaustion never escalates (the afk port delta: "retry budget → gate escalation, not die-or-retry"). There is no operator give-up path at all (no stop verb; a crashed-and-abandoned run blocks its change name indefinitely), the `'failed'` memo status and the `R5` ladder rule are vocabulary with no writer, and `readEvents` throws on a torn tail line — a kill -9 mid-append bricks every subsequent fold. C6 is the plan's reserved row for exactly this.

## What Changes

- **Failure taxonomy, typed at the seams**: `StageHaltError` gains a kind (`exhausted` | `precondition`); agent-layer's schema-validation exhaustion is retyped `AgentValidationError` (message-preserving, no frozen-test edits); the spawn seam throws typed `SpawnError` for transport failures. Untyped errors stay crash-shaped (work-module bugs keep refusal-alarm semantics). Review and intake enter failure vocabulary mechanically via the shared agent layer.
- **`stage_failed` event**: root-level bookkeeping (`failures[stage]` ledger, non-projected residue); the stage map is untouched — failure is crash-shaped by design; the bracket stays open.
- **Retry budget**: per-stage consecutive, compiled constant (`PLAN_REPLAN_PASSES` precedent); under budget the loop re-runs the bracket immediately through existing self-successor mechanics (afk-friendly); `escalationOwed(context)` is one pure check consulted symmetrically by the live loop and resume derivation.
- **Escalation gate — fourth mode `'escalation'`** riding the C4 stack (settle seam, waiter, claims, deadlines; `'plan'`-precedent union widening): interstitial presentation (the presented event is the mover, review's cap-hit precedent), outcomes approve=retry / extend=+budget / abort (the mode-blind aborted edge); the failure ledger and resumeHint render as the gate content; `R5` finally emitted as the cost-fail-closed attribution rung; standard expiry inherited unchanged (never-abort invariant); steer answers it (`extend` valid here, `abort` valid).
- **Operator abort**: `stop` verb — calm-stop marker for live runs (existing machinery, first producer), `run_abort` event for dead/parked runs → `aborted` final → memo terminal → session slug released.
- **Memo honesty**: every park writes (retires the stale-`running` bug); `'failed'` = failure-caused terminal (abort settled at an escalation gate) — parity-free, no historical run ever persisted it.
- **Validation close-out**: torn-tail tolerance (malformed final line tolerated-as-absent; interior corruption stays a hard error) — the discovered latent bug; prefix property (every event-prefix of every fixture folds to a legal state) and resume-equivalence (deterministic stubs re-driven from every prefix reach the same terminal) — the kill -9 drill, in-process; W5–W7 crash-window recoveries (owed escalation presentation, escalation mover rows targeting the still-active stage).
- **Corpus**: five synthetic failure scenarios.

## Capabilities

### New Capabilities

- `afk-runner-recovery`: failure declaration, retry budget, escalation gate, operator abort, terminal memo truth, and crash-resilience validation for afk-runner runs. Sibling of `afk-runner-kernel`/`afk-runner-think-half`/`afk-runner-gate`/`afk-runner-tail` (complete-but-unarchived). Without it: stage failure is unbounded free retry with no operator visibility, budget exhaustion dies silently instead of gating, abandoned runs hold their session ids forever, and a torn log tail bricks resume.

### Modified Capabilities

- None in `openspec/specs/` — afk capabilities are not yet archived; kernel/gate/tail requirements hold and are exercised, not weakened.

## Impact

- Code: `afk-runner/src/**` (drive-loop catch, kernel event + edges + root handler, gate stack mode rows, resume recovery, memo projection, CLI `stop`, spawn-seam typing, agent-layer retype), `tests/afk-runner/**` (fixtures, prefix harness, drills). No `sdd-runner/` changes — the retype lands in the afk copy only.
- Docs: `docs/architecture/afk-runner.md` (C6 row, layout, park vocabulary).
- No platform/task-instance or config-context surface; repo-local run dirs (compliance inherited).

## Non-goals

- Terminal reopen ("explicit reopen, no casual resurrection") — no C7 need; afk's reopen semantics stay undescribed in V1.
- Veto-with-redirect at escalation gates (retry-with-guidance via the steer surface) — declined for C6, recorded as a follow-up candidate.
- Separate infra-failure counter — one counter, kinds visible in the escalation content; separate columns wait for C7 evidence.
- Auto-abort on escalation deadline expiry — declined (breaks the never-abort invariant); `steer abort` is the death-by-timer path.
- Real-subprocess SIGKILL tests — the harness is in-process by design (hermetic I/O guard).
- Editing sdd-runner, `plan`-mode gates (U2), TUI (U8), snapshot memo (U7), gate reopen.
