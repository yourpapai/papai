<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: sdd-runner pipeline completion

## Why

The runner declares an idea-to-`tasks.md` pipeline, but on a cap-hit review loop —
the norm at depth L on substantial changes — approving the early gate finalizes the
run **without decompose/atomicity**, permanently delivering no `tasks.md` (observed
on the `kiss-help` run: 7 review rounds, none clean, four early gates; approval at
any of them would have ended the run taskless). Two compounding faults: convergence
(a zero-finding round) is near-unreachable for an adversarial reviewer on a large
design, and early-gate approval silently amputates the pipeline instead of
continuing it.

## What Changes

- **Early-gate approval becomes "human-decree convergence"** (**BREAKING** gate
  semantics): approving an early (cap-hit) gate no longer finalizes the run. The
  pipeline continues into decompose → atomicity → final gate, exactly as a
  converged review loop would. "Approve" means "I accept the remaining findings as
  resolved — proceed," never "stop here with partial output."
- **Severity-based convergence**: a cap-hit round with zero open BLOCKERs and zero
  open MATERIALs (nitpick-only, each resolved or dismissed) counts as converged and
  flows into decompose without presenting an early gate. Blockers/materials still
  force the early gate for human sign-off.
- **`resume` learns the post-review stages**: a run interrupted during decompose,
  atomicity, or the final gate can be resumed (today `resume` supports only the
  `review` stage and throws for anything else).
- The final gate reached via early-approval continuation presents at the next gate
  version (`gate-<n+1>.md`), preserving the versioned audit trail, and its digest
  carries the full `tasks: <done>/<total>` rendering.
- Gate-file copy is updated so every decision states its downstream effect
  (approve → "continues to decompose + atomicity, then a final gate"), ending
  consequence-blind approvals.

## Capabilities

### New Capabilities

- `sdd-runner-pipeline`: stage flow and completion semantics of the autonomous
  pipeline — convergence criteria (clean round or severity-based), gate outcomes
  and their downstream effects, stage-resume coverage, and the versioned gate
  audit trail.

### Modified Capabilities

None — `openspec/specs/` has no existing capability specs for the runner.

## Impact

- **Code:** `sdd-runner/src/orchestrator.ts` (early-gate approval continuation,
  resume stage coverage), `sdd-runner/src/gate-digest.ts` (`finalizeGate` becomes a
  continuation, not a terminus), `sdd-runner/src/review-loop.ts` (severity-based
  convergence outcome), `sdd-runner/src/run-state.ts` (resume-point derivation for
  post-review stages), `sdd-runner/src/extend-round.ts` (shared post-convergence
  path), `sdd-runner/src/gate-render.ts` / `gate-model.ts` (decision copy and
  consequences).
- **Docs:** `docs/architecture/sdd-pipeline.md` (gate protocol, depth-profile
  expectations).
- **Tests:** `tests/sdd-runner/` — new continuation, convergence, and resume-path
  coverage.
- **Behavioral compatibility:** the only intentional break is early-gate approve
  semantics; abort/veto/extend are unchanged. A completed-without-tasks run from
  before this change is unaffected (its state is already finalized).
