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

### MATERIAL-only cap-hit path

When the round cap is reached with 0 BLOCKERs but ≥1 MATERIAL finding still open, the early gate surfaces additional content so the human can distinguish a converging loop from a stuck one:

- **Cap-hit trajectory** — a per-round burndown (`round k: <b>m <n>n · <resolved> resolved · <dismissed> dismissed · <verdict>`), rendered by `formatTrajectoryBlock` from `events.ndjson` replay. NITPICKs are count-only (not expanded).
- **Open MATERIAL findings** — each open MATERIAL finding gets a checkbox (`- [ ] F<n> <gap>`) with `resolver: <resolution> — <outcome>` beneath. Leaving a box unchecked is a veto (optional `→ <redirect>`).
- **Trajectory-reviewed ack** — a required `T1` checkbox under a `### Trajectory reviewed` heading, present only when cap-hit fires with 0 BLOCKERs. The gate SHALL NOT be approvable without checking it; `--confirm-all` checks it like any other box. This is the vacuous-approval guard: without it, an early gate with 0 blockers and 0 assumptions would be trivially approvable.

### Open-MATERIAL-finding veto

Open MATERIAL findings rendered as `- [ ] F<n>` checkboxes have the same semantics as assumption boxes: checking = proceed, leaving unchecked = veto (optional `→ <redirect>` beneath). `--confirm-all` checks them.

### Veto resolver pass

A veto triggers exactly one resolver pass before the gate is re-presented at `gate-<n+1>.md`:

1. **Sidecar update** (`updateAssumptionsFromVetoes` in `veto-updater.ts`) — for each vetoed assumption with a redirect, the runner mechanically sets `assumption.text = redirect` in `resolutions-<round>.json`; assumptions vetoed without a redirect are marked `status: 'vetoed'`. Finding vetoes with a redirect update the matching resolution's `outcome`. This is deterministic — no agent intelligence is needed.
2. **Updater agent** (`runVetoUpdater`) — a `resolver`-role `runStageAgent` spawn (`veto-updater.ts`) applies the redirects to the affected artifacts. The prompt (built by `buildVetoUpdaterPrompt`) names each vetoed entry (id + original text/gap + redirect), embeds the current artifact content, instructs the agent to apply the redirects and scan for stale references, and names the report sidecar (`veto-updater.json` → `{ files_updated: [...] }`). The spawn follows the drafter's write + `openspec validate --strict` + retry-on-failure pattern (up to 2 attempts).
3. **Drift check** — if `files_updated` touches `specs/` or `tasks.md`, the runner invokes the existing drift-check resolver to reconcile `tasks.md`.
4. **Re-presentation** — `presentGateAt` re-materializes `assumptions.md` from the updated sidecar and writes `gate-<n+1>.md` with new artifact hashes, cost/duration, and `state.gate.mode` preserved (early → early, final → final). The outcome is `'veto'` with `version: n+1`.

`vetoRedirects(outcome)` (`gate.ts`) is the wiring point: it pulls the veto list from the gate outcome and feeds the updater. Repeated vetoes converge only when the human approves — each cycle produces a content-different `gate-<n+1>.md` because the updater rewrites the affected artifacts.

### Nitpicks at the final gate

When the loop converges with surviving nitpicks (≤3 NITPICK findings), the final gate lists them under `### Nitpicks (informational)` as plain bullets (gap + resolver outcome). No checkboxes — they are informational only, not a veto surface.

## Commands

```bash
bun run sdd-runner:start -- <task-file> [--depth S|M|L] [--verbosity brief|normal|debug]
bun run sdd-runner:start -- resume <runId>
bun run sdd-runner:start -- gate resume <runId> [--confirm-all] [--abort]
bun run sdd-runner:start -- report <runId> [--pr]
```

Or via the thin wrapper: `/sdd:auto <task-file>` _(not yet implemented — intended papai chat command that shells out to `sdd-runner:start`; use the `bun run` form above for now)_.

### Live rendering

`bun run sdd-runner:start` picks its renderer once at harness construction (`index.ts buildHarness(verbosity)`):

- **Dynamic (TTY, `normal`/`debug`)** — `DynamicRenderer` (`sdd-runner/src/live-renderer.ts`) redraws a fixed-position block on every event instead of scrolling. Three zones:
  - **Pipeline map** (top) — the output of `renderPipelineMap(state)`, finally exercised live (it was tested but never called pre-change). One line per stage with `✓ done` / `▶ active (round n/cap)` / `· pending` / `— skipped` markers.
  - **Slot lines** (middle) — one per active agent, driven by the new L0 `tool_use` events: `<agent> ▶ <tool> <arg?>`. Cleared on that agent's `done`.
  - **Status line** (bottom) — `round n/cap · in <tok> / out <tok> · $<cost> · <elapsed>`, accumulated from `done` and `step_finish` events.
  The L0 events reach the renderer through a `ProgressReporter` adapter (`agent-reporter.ts`) wired into the `runAgent` call at `agent-layer.ts`; `slot()` parses the review-loop slot line and emits `tool_use`, `usage()` emits `step_finish`, and the other reporter methods are no-ops (the renderer owns the block). ANSI primitives are inlined from `review-loop/src/live-renderer.ts` rather than imported cross-workspace; the `shared-tui-renderer` proposal can consolidate them later.
- **Line (non-TTY / `--verbosity brief`)** — `LineRenderer` (`renderer.ts`), byte-identical to the pre-change append-only output. This is the CI / pipe / log-file contract; the TTY check is hard-gated so a redirect never gets ANSI escapes. The one additive change for both modes: `done` now renders `<agent> done · in <tok> out <tok> · $<cost>` instead of bare `<agent> done`.

`--verbosity` is threaded from the CLI through `StartOptions.verbosity` and `buildHarness(verbosity)` to `createRenderer(stream, verbosity)`. `brief` suppresses L1; `debug` raises the altitude filter to show L0 tool-call/step events as scrolling lines in line mode (the dynamic mode always shows them in the block). Resume/gate/report inherit the harness's construction-time `normal` — those paths produce artifacts, not live progress.

The deleted `--wait` flag and `renderGateScreen` (commit `fe3498040`, "placed for a live-watching TUI future that didn't ship") stay deleted — that was an interactive gate-editor concern, separate from progress rendering. The consumer that prompted re-visiting live output is the operator running `sdd-runner:start` interactively (most often via `/sdd:auto`).
