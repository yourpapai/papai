<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The C7 live proof's incident B exposed the gate settle seam's structural holes: veto is unreachable at item-less (0/0/0) final gates — worse, any `## Gate response` section there settles as *approve* — and a malformed answer or steer veto crashes the foreground waiter, poisoning the gate file into a resume crash loop. Digging widened the family: a permanent deadline `expiry-claim` makes deadline-configured gates unanswerable after two rule-none expiries, and a crash after `presented` orphans the presenting stage's bracket so the run can wedge against the completed guard in a duplicate-settle storm. This is U9's R1 step: it must land **before** sdd-runner retirement, or the holes fossilize with no fallback runner.

## What Changes

- **Gate-level decision grammar**: `APPROVE` and `VETO[: <redirect>]` own-line directives, symmetric with `ABORT` / `→ RUN 1 MORE`; a zero-signal response (no directive, no declared-item box, no answer, no ack) is rejected instead of vacuously approving. Machine producers (`renderGateAnswers`, the R1 ladder render) emit the explicit directives; the render⇄parse roundtrip is pre-flighted in memory before the gate file is ever overwritten.
- **Parse-error containment**: operator-input settle failures (parse, integrity, unreadable sidecar) return a rejected result with a reason instead of throwing; the waiter surfaces feedback (sibling `gate-<v>.response-error.md` + stdout) and keeps waiting, re-attempting only after the gate file digest changes. Producer-lane failures stay crash-shaped (refusal alarm).
- **Attempt-scoped settle claims**: one pid-carried `settle-claim` held for the duration of a single settle attempt (claim → parse → integrity → append-or-reject → release); the deadline expiry path adopts it, the permanent timestamp `expiry-claim` and its honored-as-held check retire, self-reclaim is idempotent.
- **Mid-presentation crash recovery**: resume appends the owed `stage_exit` of an orphaned presenting stage when a final gate is presented-unanswered; the waiter exits as external on an already-answered gate record.
- **Revision consumer completeness**: a gate-level veto reaches the veto-updater as a first-class whole-gate redirect (new input field, not a synthetic item id).
- **Steer hygiene**: bare `veto` / `veto <text>` map to the gate-level veto; unparseable steer files are warned and consumed, never silently lingered.

## Capabilities

### New Capabilities

- `afk-runner-gate-settle-robustness`: the settle seam's total-over-operator-input contract — expressible decisions at every gate shape, containment with feedback, attempt-scoped claims, and the presentation-crash recovery window. Extends C4's change-local `afk-runner-gate` (settle seam, claims, waiter); a separate spec because the afk-runner capabilities live change-local per the C4–C7 convention. Without it: item-less gates cannot be vetoed and can be silently approved by prose, malformed answers crash-loop the waiter, and deadline-configured runs can wedge permanently.

### Modified Capabilities

None — `openspec/specs/` carries no afk-runner capability yet (the C4–C7 specs are change-local, complete-but-unarchived).

## Impact

- Code: `afk-runner/src/work/{gate-model,gate-answers,gate-settle,gate-waiter,waiter-steer,gate-claims,gate-expiry,gate-prelude,gate-render,veto-updater}.ts`, `drive/resume.ts`, `run-recovery.ts`, `graph/pipeline-work.ts`.
- Tests: `tests/afk-runner/work/` (gate-model, gate-answers, gate-waiter, gate-deadline, gate-settle-escalation suites + revision-consumer and natural-sequence deadline harnesses).
- Docs: `docs/architecture/afk-runner.md` (gate lifecycle + C-plan sections).
- No papai-core (`src/`) impact; no platform/task instance, scope-model, or config-context effect (workspace-local engine). Event schemas unchanged — the veto redirect stays file-borne.
