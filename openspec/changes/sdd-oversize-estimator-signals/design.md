# Design — sdd-oversize-estimator-signals

## Context

See proposal.md — the zero-fire census and the kb counterexample. Current constraints: `buildEstimatorPrompt` (`intake.ts:101`) carries the self-declaration predicate; `DepthClassificationSchema` (`agent-layer.ts:68`) already has optional `oversize` (undefined reads false — the additive-field precedent this change extends with `oversize_signals`); `runIntake` routes on `estimation.value.oversize === true` after the estimator, before scaffolding; the plan branch (`intake.ts` plan union, `plan.ts`, `children.ts`) is landed and tested but production-unexercised. The trilogy's delta spec (unarchived) owns planner/gate/child semantics.

## Goals / Non-Goals

**Goals:** a routing verdict grounded in observable signals; operator override in both directions; every routing decision evented; threshold permissive enough that the corpus's single true positive routes and its near-miss does not.

**Non-Goals:** plan-branch semantics, depth S/M/L logic, ROUND_CAPS, task-size heuristics (declined in proposal — analyzer measures first).

## Decisions

### D1 — Verdict = conjunction of three existing signals; threshold compiled at 30 files

`OVERSIZE_MIN_IMPLICATED_FILES = 30` beside the other compiled constants (`config.ts`), compared against `implicated_files.length`; conjunction with `signals.novelty === 'new-subsystem'` and `signals.cross_module === true`. Corpus calibration: kb (36, new-subsystem, cross-module) routes; build-claude-code-cli (19, same flags) stays single-path — the only two runs with the flag pair split cleanly at files. The prompt keeps asking for the raw signals and stops instructing self-declaration; the runner (not the agent) computes the verdict from the sidecar — the estimator reports observations, deterministic code decides. Alternative rejected: letting the agent emit the verdict with signal guidance — keeps routing correctness inside prompt compliance, exactly the failure being fixed.

### D2 — Verdict computed in `runIntake`, recorded in sidecar and event

After the estimator spawn, `runIntake` computes `oversize` from the sidecar (overriding any agent-emitted boolean), writes `oversize_signals` (`{ novelty, cross_module, implicatedFiles }`) into the depth sidecar, and emits the `depth` event with additive `oversize`, `oversizeSignals`, `routeForced` fields. Old sidecars/events parse unchanged (all optional). Alternative rejected: recomputing the verdict at resume from raw signals — resume reads the recorded verdict; recomputation would let a threshold change silently re-route a mid-flight run.

### D3 — `--plan` start flag mirrors `--depth`'s escape hatch

`--plan` sets a forced route recorded as `routeForced: 'plan'`; an explicit `--depth` with no `--plan` keeps today's skip-planning path (`routeForced: 'depth'`). Mutual exclusivity fails loudly at arg parse (`--plan` with `--depth` names the conflict). The routing table in `cli-routing.ts` gains the flag alongside `--depth`'s handling. Alternative rejected: a config key — routing is per-run intent, not per-workdir standing policy.

### D4 — No threshold config key, ever; recalibration is a code change with corpus evidence

The threshold ships compiled. If the analyzer later shows false routing at 30, the fix is a constant change with a corpus report attached — the ROUND_CAPS lesson (caps were aspirational until measured) argues against shipping tunable knobs before measurement.

## Hook / TDD interaction

`intake.test.ts` red first (verdict computation over corpus-shaped sidecars: kb routes, claude-cli does not, missing signals do not; flag exclusivity), then `agent-layer.test.ts` (`oversize_signals` schema both directions), `events.test.ts` (additive depth fields, old-event pins), `cli-routing.test.ts` (`--plan` parse + exclusivity).

## Risks / Trade-offs

- [n=1 calibration] → the conjunction is the strictest defensible form (three signals must all agree); a false positive costs one plan-gate veto; a false negative is today's status quo. The analyzer's routing-rate metric watches both.
- [Agent pads `implicated_files` to force/avoid routing] → the estimator is read-only and uninterested in routing (D1 removes its stake); `oversize_signals` makes padding visible per run.
- [Unarchived trilogy spec drift] → this change's spec self-limits to routing; if the trilogy's archive renames plan-branch requirements, only the intake handoff point (oversize → plan branch, no scaffold) needs re-referencing.

## Migration Plan

No config, no DB, no event removals. Behavior change is precisely: sidecars that previously could not carry `oversize: true` now can, deterministically. Existing mid-flight runs resume by their recorded verdicts. Rollback = revert; routing reverts to never-fire, which is the measured current state.
