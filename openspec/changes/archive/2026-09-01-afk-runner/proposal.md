# afk-runner — proposal

## Why

The `sdd-runner` pipeline hardcodes a straight line (intake→…→gate) as if-chains in `orchestrator.ts`; `stage-machine.ts` is a timing wrapper, not a machine. The unfinished afk spike (vendored, gitignored, at `reports/afk/`) has the right lifecycle topology — full SDLC graph with first-class failure/conflict states — on a weak substrate (in-memory artifacts, no gates, no budget economics, no persistence). V1 of a new `afk-runner/` workspace combines them: afk's graph concepts re-hosted on sdd-runner's event-sourced substrate, proven by replaying historical runs through a declarative graph kernel. This change admits only the foundation and the kernel (C1–C2 of the C1–C7 plan in design.md).

## What Changes

- New workspace `afk-runner/` beside `sdd-runner/`; sdd-runner itself is untouched until a later retirement change.
- Substrate core copied in (not imported): event schemas, ndjson event log, replay fold, run-dir conventions.
- A **graph kernel**: lifecycle states/transitions/guards declared as data over XState v5 used purely as a reducer (`transition()`/`initialTransition()`, no actors); machine state is exclusively a fold over the append-only `events.ndjson`.
- A **golden-replay parity harness**: historical `sdd-runner` run logs are fixtures; folding them through the kernel reproduces the legacy `ReplayState` stage map.

## Capabilities

### New Capabilities

- `afk-runner-kernel`: machine-as-data lifecycle graph whose state is derived solely by folding the append-only event log; deterministic, replayable, crash-resumable by re-fold. Without it, every lifecycle extension (recovery states, gates-as-states, hierarchical child runs, portfolio altitude) keeps accreting orchestrator if-chains, resume stays a heuristic, and the afk topology cannot be adopted on this substrate. The existing module that looks closest, `sdd-runner/src/stage-machine.ts`, is a 40-line stage-entry/exit emitter and does not model transitions, guards, or graph shape; no other module covers this.

### Modified Capabilities

None. `sdd-runner-pipeline` and `sdd-runner-autonomy` keep governing sdd-runner unchanged; this change adds a parallel workspace. Gate-as-state (which will touch autonomy semantics) is a follow-on change (C4), not this one.

## Impact

- Code: new `afk-runner/` workspace only; root tsconfig/knip/jscpd pick it up like any workspace. No chat-platform instance, task instance, or config-context surface is touched (repo-local developer tooling; no per-user/group/thread scope impact, no DB).
- Dependencies: adds `xstate` (justified in design).
- Docs: adds `docs/architecture/afk-runner.md`; `docs/architecture/sdd-pipeline.md` unchanged until retirement.
- The afk spike at `reports/afk/` is gitignored reference material: the graph is ported by **reimplementation**, never by importing from a non-repo path.

## Non-goals

Declined for this change, recorded as the delivery plan and follow-ups ledger in design.md:

- C3–C7 as separate follow-on changes: think-half on graph, gate-as-state, tail on graph, `agent_failed` recovery, live E2E proof.
- U1–U9 follow-ups: team/mission spawner, child-actor execution, execution-half states (code review/verify/release), documenting+reflection, L4 portfolio / vision intake, `conflict_detected`, snapshot memo (D-variant cache), TUI re-host, sdd-runner retirement + cross-run budgets.
- afk's agent runtime, event bus, blackboard, discussion engine, RAG: dissolved into the substrate (change folder is the blackboard; `events.ndjson` is the bus) — deliberately not ported.
