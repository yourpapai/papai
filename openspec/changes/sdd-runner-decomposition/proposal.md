# Proposal: sdd-runner-decomposition

## Why

`sdd-runner` pushes every admitted task through exactly one OpenSpec change, so an oversized request still yields a single best-effort artifact set that arrives under-explored, thin on scenarios, and too rough for production grade. The pipeline needs to recognize "bigger than one change" and recurse: split the work into independently shippable child changes and run the full pipeline per child.

## What Changes

- Intake gains an oversize verdict: alongside the S/M/L depth profile it classifies whether a task exceeds single-change capacity and, when it does, produces a decomposition plan instead of scaffolding one change.
- A planning step drafts child change definitions (name, scope, acceptance signals) and validates them: each child must be independently admissible, the children plus recorded declined scope must jointly account for the whole parent intent with nothing dropped or duplicated, and child count/depth must fit enforced operational bounds held as compiled constants, not config keys (recursion allowed but bounded).
- The validated plan is presented at a human gate (or settled by the autonomy ladder under its never-cut invariants) before any child starts.
- Each approved child executes as a full nested `sdd-runner` run — same stages, gates, budget, event log — and a child may itself be decomposed.
- Run state, reports, cost aggregation, and live views gain a parent/child tree: a parent completes only when every child completes; abort/veto propagate downward; every node stays individually resumable.
- Runs receiving a negative oversize verdict behave exactly as today.

## Capabilities

### New Capabilities

- `sdd-runner-decomposition`: oversize detection at intake, decomposition planning and validation, gated plan approval, nested per-child pipeline execution with a recursion bound, and parent/child run-tree state, reporting, and resume semantics.

  Without it, large requests keep collapsing into single shallow changes, and multi-change efforts must be shepherded manually outside the runner, losing gates, event logs, and cost roll-up.

  Existing coverage: `decompose.ts` and the atomicity stage already split *tasks within one change*; neither creates additional changes nor spawns nested runs. The pipeline is the right seam to extend; these spec-level behaviors are new, hence a separate capability.

### Modified Capabilities

- `sdd-runner-pipeline` (MODIFIED: completion invariant): "No completion path skips the task list"
  quantifies over *any* run reaching `completed` and names abort as the only other exit, but a
  composite parent completes with no change directory or `tasks.md` of its own — its quality control
  is the plan gate plus each child's full pipeline (design D5), so the invariant as written would be
  falsified. The delta scopes the tasks.md invariant to single-change runs and states the
  composite-parent completion criterion instead; the early-gate approval path itself is untouched
  (composite parents never enter it).
- `sdd-runner-output` (MODIFIED: frozen byte contract): non-TTY output is byte-frozen with exactly
  one permitted addition (the done-line model id), but composite runs necessarily emit more bytes —
  at minimum `[plan]`/`[execute]` stage lines through the same LineRenderer contract. The delta
  keeps single-change runs byte-identical (matching this change's zero-observable-change goal for
  non-oversized runs) and declares the decomposition stage/tree lines a permitted addition on
  composite runs only.

Unmodified capabilities, for the record:

- **`sdd-runner-autonomy`**: inside any node of a run tree, the ladder's spend input becomes committed-plus-projected *subtree* spend instead of the node's own spend. Every autonomy SHALL survives unchanged — R4's "exceedance causes a human gate" fires in strictly more cases and never fewer, the never-cut invariants hold, and no rule gains an auto-decision the current text forbids. Single (tree-less) runs evaluate identically because their subtree equals themselves; only the ladder's view tightens, which is normative in this change's "Tree-wide cost accounting and tree visibility" requirement.
- **`sdd-runner-cli`**: the routing verb's contract — resolve id/prefix, route to the pending point, fail loudly on ambiguity — is unchanged; routing *into* a child is new destination selection specified by the delta spec's "Per-node resume and tree-aware routing" requirement.

## Impact

- Code (`sdd-runner/src/`): `intake.ts` (oversize verdict), `orchestrator.ts`/`stage-machine.ts`/`run-state.ts` (plan stage + tree state), `report.ts`/`replay.ts`/live views (tree rendering), `auto-policy.ts` (tree-wide budget), `cli-routing.ts`/`continue.ts` (child-aware routing); reuses the `opencode run` driver and decompose/atomicity seams.
- Artifacts: decomposition plan sidecar + child-run links in the parent run dir; children use the standard run-dir layout.
- Docs/specs: `docs/architecture/sdd-pipeline.md` gains a decomposition section; new `specs/sdd-runner-decomposition/spec.md` carries ADDED requirements plus MODIFIED deltas for `sdd-runner-pipeline` and `sdd-runner-output`; `sdd-runner-autonomy` and `sdd-runner-cli` specs untouched.
- Dependencies: none added.
- Scope: runner-only operator tooling — no platform/task instances, no storage or config-context scopes affected.

## Non-goals

- Parallel child execution — children run sequentially at first.
- Re-decomposing after intake; mid-run steering stays veto/extend only.
- Merging child outputs back into a parent change folder — links and roll-ups only.
- Chat-side surfaces (`/sdd:auto` UX) beyond passing the task file through unchanged.
