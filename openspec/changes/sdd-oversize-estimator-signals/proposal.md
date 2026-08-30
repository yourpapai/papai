# sdd-oversize-estimator-signals

## Why

The run-decomposition plan branch (planner, plan gate, child runs — built by the `sdd-runner-decomposition` trilogy) has **never executed**: zero `plan`/`child_spawned` events across all 14 retained runs, and `oversize` is absent from all 11 estimator depth sidecars. Root cause is the estimator prompt's predicate: *"Set oversize true only when the task declares scope too large"* — a self-declaration trigger no task satisfies. The canonical counterexample is the knowledge-base run: strongest corpus signals (`cross_module: true`, `novelty: new-subsystem`, 36 implicated files, a very large task document), classified single-path L, which then spiraled for 10 unconverged rounds producing an internally inconsistent, unimplemented 81-task change. The machinery built for exactly that run was unreachable.

## What Changes

- The estimator prompt's oversize predicate is re-grounded in the estimator's own observations instead of task self-declaration: `oversize: true` when the conjunction of structural signals holds (novelty `new-subsystem` AND `cross_module` AND implicated-file count ≥ threshold), with the threshold a compiled constant, not a config key.
- The estimator sidecar gains an optional `oversize_signals` record (the values it weighed), so routing decisions are auditable and the threshold can be recalibrated from real sidecars by the analysis tooling — measurement before enforcement: the constant ships permissive (≥ 30 files) so the corpus's only true positive (kb, 36 files) routes to the planner while `build-claude-code-cli` (19 files, otherwise identical signals) stays single-path.
- `--depth` override continues to skip planning entirely; an explicit `--plan` start flag forces the plan branch regardless of the estimator verdict, giving the operator the routing decision the estimator cannot reliably make yet.
- Intake emits the signals in the `depth` event (additive fields), so plan-branch routing rates are visible in every future run's log.

## Capabilities

### New Capabilities

- `sdd-runner-intake-routing`: estimator oversize-verdict semantics — what signals the verdict is grounded in, how the operator overrides it, and how routing decisions are recorded. No existing main spec covers intake routing (the trilogy's delta spec for the plan branch lives unarchived in `openspec/changes/sdd-runner-decomposition/`); without this capability the trigger stays a prompt sentence with no auditable semantics, and the plan branch stays measured-dead code.

### Modified Capabilities

_None._

## Impact

- Code: `sdd-runner/src/{intake,agent-layer,events,cli-routing}.ts` + tests under `tests/sdd-runner/`; prompt change in `buildEstimatorPrompt`.
- Scope model: offline runner workspace; no chat surfaces, no DB, no config-context state; new persisted state is additive sidecar/event fields keyed by run id.
- Docs: `docs/architecture/sdd-pipeline.md` (Intake stage, Depth profiles, Composite runs).
- Coordination: the trilogy's plan-branch delta specs remain the authority for planner/gate/child-run behavior; this change touches only the routing verdict.

## Non-goals

- Planner, plan-gate, or child-run semantics (owned by the unarchived `sdd-runner-decomposition` trilogy).
- Depth S/M/L classification logic or `ROUND_CAPS` recalibration (separate concern; measured in corpus but not routed here).
- Task-document size as a routing signal (candidate noted for the analyzer to measure; declined now — one observed spiral is too thin a basis).
- Auto-routing without audit: the estimator never silently routes on signals alone unless the conjunction threshold is met, and every routing decision is evented.
