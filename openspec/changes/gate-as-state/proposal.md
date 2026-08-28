## Why

C3 leaves afk-runner able to *present* a gate but never settle one: a cap-hit run parks `gate-pending` and nothing can answer it — the four settle producers (TUI, hand-edited file, deadline waiter, autonomy ladder) exist only inside frozen sdd-runner orchestrator code. The gate is also context-only today, so the parked reason is derived by context sniffing rather than being machine state. C4 makes the gate lifecycle first-class graph topology and re-hosts settlement, so a run can decide, continue, abort, or veto — the decision loop C5's tail and C7's live proof need.

## What Changes

- **GATE substate** (`gate.awaiting`): `gate.presented` moves position into it; exits key on legacy mover events — `round_open` → review (extend), `stage_enter(decompose)` → decompose (approve-early), `stage_enter(draft)` → draft (veto), `gate.answered`+all-stages-done → completed, `gate.answered` `outcome=abort` → aborted. Gate events never touch the stage map; per-state edges re-declare the root assigns they shadow.
- **Additive optional `outcome` on `gate answered`** (approve/veto/extend/abort): new logs are explicit, old logs derive from what follows; it closes the answered↔mover crash window and enables owed-mover resume.
- **Settle seam re-host**: answers → render → parse-back → integrity check → append; the four settlers are producers over it (ladder included — it already renders `GateAnswers` in sdd-runner). First-writer-wins claims (`gate-<n>.settle-claim`, legacy `expiry-claim` honored) kept as edge IPC, never truth.
- **Foreground waiter** as a run-level post-park continuation: poll the gate file (3-tick stability guard) and `steer.md`; on settle, re-evaluate and re-drive or exit. Holder stays alive while waiting; stop at gate-pending is a no-op.
- **Autonomy ladder producer**: R1–R4 evaluated at presentation, `auto_decision` events incl. `rule=none`; R1 auto-approve and R2 auto-extend settle through the seam.
- **Deadline as log-truth, thin**: optional `deadlineAt` on `gate presented`, one re-arm event; expiry runs the conservative ladder, config-gated, minimal polish (unused in practice).
- **`reviewOutcomeOf` fix**: only an *unanswered* gate parks cap-hit; an answered gate releases continuation (latent C3 bug the producers expose).
- **Veto**: zero corpus attestation → synthetic-marked scenario fixture + veto-updater revision round.

## Capabilities

### New Capabilities

- `afk-runner-gate`: gate lifecycle as graph state — presentation, awaiting, settlement by four producers, outcome-keyed continuation, deadline expiry, owed-mover resume. Sibling of `afk-runner-think-half`/`afk-runner-kernel` (both complete-but-unarchived). Without it: every gate-pending run is permanently dead-ended, autonomy decisions never execute, and C5's tail has no decision loop to flow from.

### Modified Capabilities

- None in `openspec/specs/` — the afk capabilities are not yet archived; kernel/think-half requirements (log-is-truth, append boundary, resume by replay) hold and are exercised, not weakened.

## Impact

- Code: `afk-runner/src/**` (kernel event/context growth, gate compound state, drive-loop compound-position handling, settle/waiter/ladder work modules, gate rendering copies), `tests/afk-runner/**` (L-fixture truncation goldens, completed-settle golden, synthetic veto fixture). No `sdd-runner/` changes — copies only.
- Docs: `docs/architecture/afk-runner.md` (C4 row, engine loop note).
- No platform/task-instance or config-context surface; repo-local run dirs (config-rule compliance inherited).

## Non-goals

- Gate reopen (D9) — deferred to a later change; `completed` stays honestly terminal.
- C5 tail work: decompose/atomicity stages, the gate-stage final-presentation work module, report. Final gates are fixture-exercised in C4; live-reachable after C5.
- Interactive TUI screen (U8) — the seam accepts answer objects; no renderer.
- C6 failure vocabulary: `killed`/stall/timeout/agent-failure states; `killed.cause` untouched (decisions vs infrastructure).
- `plan`-mode gates — dormant vocabulary.
- Memo/state.json deadline fields — the deadline lives in the log.
