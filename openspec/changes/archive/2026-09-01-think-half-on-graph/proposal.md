## Why

afk-runner (C1–C2) is a read-only replay engine: the graph kernel proves stage-map parity over historical logs but owns no runs — sequencing knowledge still lives only in sdd-runner's frozen imperative orchestrator. C3 makes the graph the driver of live runs (the spec's "machine as data" scenario becomes load-bearing) and completes derived-state parity, so C4–C7 have a live engine to attach to. The driver-vs-mirror question must be settled before gate and tail states land, or they inherit orchestrator coupling permanently.

## What Changes

- Kernel context owns the full legacy `ReplayState` (depth, round, perRound/lastVerdict, gate, autoDecisions, children) via root-level target-less assigns; the golden-replay parity harness extends from `stages` to all fields. The finding→convergence tally moves into context as a scratch accumulator.
- A generic **drive loop** replaces the orchestrator: fold → `workFor(activeState)` (declared in per-state modules as data) → execute edge work → append validated events → successor-or-park. The loop names no stage; C5's tail lands as data.
- Think-half work modules copied from sdd-runner (intake, draft, review-loop + review-model, steer, materialize, agent-layer) re-hosted as edge work; the enter/exit bracket moves from `machine.runStage` calls to loop mechanics.
- An **append boundary**: every `stage.enter` append is validated against the graph (pure transition probe); refusal throws at the edge — the log records only validated transitions.
- Tier 2 substrate copied slimmed: session-id allocation, session ledger, run-dir conventions, holder/calm-stop. `state.json` is demoted to a derived memo; nothing reads it for control flow.
- Resume re-hosts as a pure read of folded context + session ledger (the A+C hybrid's artifact heuristics end); mid-think-half calm-stop/resume works, the resume self-loop staying corpus-real.
- CLI surface: start / fold-summary status / think-half resume, reporting parked runs via explicit `halted` values instead of errors.

## Capabilities

### New Capabilities

- `afk-runner-think-half`: live think-half runs driven by the graph — drive loop, work-module registry, append boundary, full derived-state parity, think-half resume. Sibling of `afk-runner-kernel` (delivered by the complete-but-unarchived `afk-runner` change; extends its machine with context assigns and live ownership). Without it: afk-runner cannot start or resume a run, C4–C7 have no execution engine to build on, and derived state beyond the stage map lives outside the machine forever — the outcome the kernel change's rejected-alternative analysis named.

### Modified Capabilities

- None in `openspec/specs/` — `afk-runner-kernel` is not yet archived to main specs; its requirements are unaffected (log-is-truth, pure transitions, closed vocabulary all hold and are exercised, not weakened).

## Impact

- Code: `afk-runner/src/**` (kernel context + fold mapping growth, new drive loop and work modules, slimmed Tier 2 copies), `tests/afk-runner/**` (extended parity harness, loop tests with fake work, ported work-module tests). No `sdd-runner/` changes — it stays frozen until U9.
- Docs: `docs/architecture/afk-runner.md` (engine loop goes live; C3 row of the delivery plan).
- No platform/task instance or config-context surface; all state is repo-local run dirs (config-rule compliance inherited from the afk-runner change).

## Non-goals

- Gate-as-state and its four settling event sources, incl. auto-policy producers and deadline fields (C4; fold-side `autoDecisions`/`gate` context lands in C3, producers do not).
- Tail states — decompose, atomicity, finals, report (C5). A converged C3 run parks in the post-review interstitial window by design.
- Agent-failure recovery and any failure/abort event vocabulary (C6); C3 throws at the append boundary instead of inventing `run.error`.
- Snapshot memo (U7), TUI re-host (U8), child-actor execution (U2) — `plan`/`child_*` events fold for parity only.
- Any sdd-runner behavior change or shared-module import; copies only, preserving the freeze.
