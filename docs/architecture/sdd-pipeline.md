<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# SDD Pipeline

The `sdd-runner/` workspace automates the outer loop of spec-driven development: a runner sub-project orchestrates drafting, fresh-eyes review, convergence, and decomposition across spawned `opencode run` agents inside one OpenSpec change, reporting progress at pipeline altitude and concentrating human attention at a single gate. The stages compose end-to-end via `src/orchestrator.ts` (`runStart`/`runResume`/`runGateResume`); `src/report.ts` synthesizes evidence-backed run/PR reports from `events.ndjson`, the change folder, and the branch git log.

## Stages

```
INTAKE → DRAFT → REVIEW LOOP → DECOMPOSE → ATOMICITY → GATE → (exit)
```

- **Intake**: depth classification (S/M/L), change scaffolding via `openspec new change`.
- **Draft**: proposal, specs, design per the `auto-sdd` schema DAG.
- **Review loop**: fresh-spawned reviewer agents per round, resolver pass, convergence predicate (0 BLOCKER, 0 MATERIAL, ≤3 NITPICK over post-resolution JSON).
- **Decompose**: tasks.md generation.
- **Atomicity**: split/merge tasks (skipped at S).
- **Gate**: single human gate with checkbox protocol.

## Event model

Three altitudes in `<runDir>/events.ndjson`:
- **L0** agent telemetry (tool use, token/cost deltas)
- **L1** agent lifecycle (spawned, retrying with reason, killed, done)
- **L2** pipeline semantics (stage transitions, round open/close, findings, assumptions, convergence, gate)

The event log is sufficient to rebuild the rendered view by replay alone.

## Depth profiles

- **S**: no design.md, 1 review round, no atomicity check. Expected path for small changes via `--depth S`.
- **M**: design.md, 3 review rounds, atomicity check.
- **L**: design.md, 4 review rounds, concurrent skeptic lens, atomicity check.

Mid-run escalation only (M gains the skeptic lens when BLOCKERs remain open after round 2).

## Gate protocol

The gate is enterable at two points: an early cap-hit presentation (before decomposition, blockers-focused) and a final presentation (after atomicity, full digest). Both share a versioned `gate-<n>.md` file with a checkbox protocol:

- Check every assumption box to **approve**.
- Leave a box unchecked to **veto** (optional `→ <redirect>` beneath).
- Answer a cap-hit blocker with `→ <answer>` or `→ OVERRIDE`.
- Write `ABORT` on its own line to abort.

Bare approve with open blockers fails — override must be explicit.

## Commands

```bash
bun run sdd-runner:start -- <task-file> [--depth S|M|L] [--verbosity brief|normal|debug]
bun run sdd-runner:start -- resume <runId>
bun run sdd-runner:start -- gate resume <runId> [--confirm-all] [--abort]
bun run sdd-runner:start -- report <runId> [--pr]
```

Or via the thin wrapper: `/sdd:auto <task-file>`.
