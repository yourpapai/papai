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
- **Review loop**: fresh-spawned reviewer agents per round, resolver pass, convergence predicate (0 BLOCKER, 0 MATERIAL, ≤3 NITPICK over post-resolution JSON). A nitpick-only cap-hit is treated as converged (see "Severity-based convergence" under Gate protocol).
- **Decompose**: tasks.md generation.
- **Atomicity**: split/merge tasks (skipped at S).
- **Gate**: single human gate with checkbox protocol.

### Admission vs division

Two of the project's rule sets pull in opposite directions on size, and read together
they look like a contradiction. They are not: they answer different questions, at
different stages.

```
   ADMISSION                          │  DIVISION
   does this scope exist at all?      │  how is admitted work broken up?
   ── DRAFT ──────────────────────▶   │  ── DECOMPOSE → ATOMICITY ──────▶
   openspec/config.yaml               │  openspec/config.yaml
     rules.proposal, rules.design     │    rules.tasks
   "state what breaks without it";    │  "independently verifiable chunks";
   "name what already covers it"      │  sdd-runner/src/decompose.ts splits
                                      │  any task bundling several
```

`rules.proposal` asks a drafter to justify each declared capability and routes scope
that fails that test into the proposal's Non-goals, where it stays visible as
declined. Nothing there argues for fewer tasks. Once scope is admitted, the atomicity
checker is free to split it as finely as the work warrants — splitting is this
repository's settled answer to size, the same answer `max-lines` gives for a file.

A minimality rule must therefore never be added to `rules.tasks`: it would argue with
a checker built to split. Nothing enforces that boundary — it is a rule about prose,
and a test matching phrasing in YAML would fail legitimate rewordings while missing
a rule worded differently. This section is the guard.

## Event model

Three altitudes in `<runDir>/events.ndjson`:
- **L0** agent telemetry (tool use, token/cost deltas)
- **L1** agent lifecycle (spawned, retrying with reason, killed, done)
- **L2** pipeline semantics (stage transitions, round open/close, findings, assumptions, convergence, gate)

The event log is sufficient to rebuild the rendered view by replay alone.

The L1 `done` event carries the model id (`done.model`) that produced its usage. Pre-change logs lacking the field are backfilled at reprice time from the agent→model map rebuilt by replaying `spawned` events.

### Cost fallback

`done.usage.costUsd` is the emit-time meter read; for subscription providers (e.g. `zai-coding-plan/glm-5.2`) it is `0` regardless of token volume. `aggregateUsage` (`usage-aggregate.ts`) runs a reprice pass before reducing: every zero-cost `done` event with tokens > 0 is repriced via `resolveCost` (`pricing.ts`), which fetches `https://metrics.dev/api.json` (60-min cache at `~/.cache/sdd-runner/models.json`) and resolves PRIMARY (configured provider's own non-zero price) → FALLBACK (median of non-zero entries across providers) → LAST RESORT (`null`). `reasoningTokens` fold into the input side of the recompute. Repricing is a no-op when emit-time cost is already non-zero, so an upstream fix composes without conflict.

The gate's `### Cost / duration` line carries a marker:
- **metered** — `costKnown: true`; cost came from the provider meter (emit-time non-zero) or a PRIMARY resolve.
- **estimated** — `costKnown: false` with non-zero cost; a FALLBACK median was applied.
- **unknown** — `costKnown: false` with zero cost; resolve fell through to LAST RESORT.

Network/parsing failures are swallowed: the resolver returns `null` for every model, so the gate degrades to `$0.00 · <walls>s · unknown` rather than halting. Pricing is a comfort feature, never a correctness gate. The live renderer's status line applies the same resolver at display time (see Live rendering) with a `~$` marker for estimated figures; only the gate digest shows the aggregate (repriced) cost with the full tristate marker.

## Depth profiles

- **S**: no design.md, 1 review round, no atomicity check. Expected path for small changes via `--depth S`.
- **M**: design.md, 3 review rounds, atomicity check.
- **L**: design.md, 4 review rounds, concurrent skeptic lens, atomicity check.

Mid-run escalation only (M gains the skeptic lens when BLOCKERs remain open after round 2).

## Gate protocol

The gate is enterable at two points: an early cap-hit presentation (before decomposition, blockers-focused) and a final presentation (after atomicity, full digest). Both share a versioned `gate-<n>.md` file that is the single decision record and hash/audit anchor.

### Deciding a gate (the three front-ends)

**Primary path — interactive session (TTY).** `sdd-runner gate resume <runId>` (or `sdd-runner continue`) on a terminal opens a guided session (`gate-session.ts`, line-oriented prompts over `node:readline` — no TUI dependency): every finding and assumption is walked as an **accept / veto / inspect** prompt (inspect prints the item's evidence and blast radius; veto collects the redirect inline), cap-hit blockers prompt for a **free-text answer or `OVERRIDE`**, the trajectory ack (T1) is an affirm prompt, and the decision menu (approve / extend / abort) prints each choice's downstream consequence beside it — the same mode-conditional phrases the gate file's `### Decisions` block renders (`decisionConsequences` in `gate-render.ts`; one copy source, two front-ends). Approve is unavailable until T1 is affirmed and every blocker is answered. The session **writes** `gate-<n>.md` from the collected answers (`gate-answers.ts` renders the identical grammar the parser accepts, guarded by a write-then-parse self-check that refuses to proceed on any drift); abandoning (q / EOF) before the final decision writes nothing and the gate stays pending.

**Flag path (non-TTY / CI / scripts).** Decision flags desugar to the same answers the session collects: `--confirm-all` (accept every item, answer every blocker with OVERRIDE, affirm the ack), repeatable `--veto <id>=<redirect>` (split on the first `=`; un-accepts that item with its redirect; unknown ids fail before any pipeline action), `--extend`, and `--abort`. `--extend` is rejected in combination with `--confirm-all`/`--veto`/`--abort`. Flags always win over prompting: a TTY with any decision flag never enters the session; non-TTY with no flags never prompts and parses the file as-is.

**Power path — hand-edited file.** The file protocol is preserved verbatim; an operator who hand-edits `gate-<n>.md` and resumes on a non-terminal gets identical behavior to today:

- Check every assumption box to **approve**.
- Leave a box unchecked to **veto** (optional `→ <redirect>` beneath).
- Answer a cap-hit blocker with `→ <answer>` or `→ OVERRIDE`.
- Write `→ RUN 1 MORE` on its own line to **extend** an early cap-hit gate by one round (early-gate only).
- Write `ABORT` on its own line to abort.

Bare approve with open blockers fails — override must be explicit.

Every presentation carries a `### Decisions` block naming each decision's downstream effect, so no approval is consequence-blind.

### Pending-gate discovery and run-id ergonomics

Multiple runs may be gate-pending concurrently, so every halt prints a next-step line with the full command and the concrete run id (`Next: sdd-runner gate resume <runId>`), copy-pasteable without editing. `sdd-runner gate` with no id lists all gate-pending runs (`listPendingGates` scans `runs/*/state.json` for a non-null `gate`, sorted by recency) with id, change name, gate version, and wait time; one pending run opens directly via `continue`. Run-id arguments accept exact ids and unambiguous prefixes (`resolveRunId`); an ambiguous prefix fails loudly listing every candidate. Prefixes are an interactive convenience — scripts should use full ids.

### Approve-continues semantics (**BREAKING**)

Approving an **early** (cap-hit) gate no longer finalizes the run. It means "I accept the remaining findings as resolved — proceed": the pipeline continues into decompose → atomicity (depth ≠ S) → a **final** gate presented at `gate-<n+1>.md`, exactly as a converged review loop would (shared post-convergence tail, `post-review-tail.ts`). The human approved the *design* at the early gate; the final gate is where they sign off the *task list* — its digest renders `tasks: <done>/<total>`. Skipping it would trade one consequence-blind approval for another.

Consequences:

- No approval path produces a `completed` run without `tasks.md`. `completed` is reached only via final-gate approval; `aborted` is the only non-completing exit.
- The final gate after an early approval carries the next gate version (`n+1`), preserving the versioned audit trail.
- A stop-early outcome remains available as `ABORT`, which honestly records that the run did not complete.

### Severity-based convergence

A cap-hit round with **zero open BLOCKERs and zero open MATERIALs** — nitpicks only, each resolved or dismissed — is treated as converged at the orchestrator level (`runPostReviewToGate`) and flows into decompose → atomicity → final gate **without presenting an early gate**. The review loop itself keeps reporting `cap-hit`; reclassification lives in the orchestrator so the loop's semantics and sidecar formats are untouched. A cap-hit round with any open BLOCKER or MATERIAL still presents the early gate for human sign-off — unresolved blocker/material findings are never auto-accepted.

### Resume and continue

`resume` re-enters at the interrupted stage, derived from artifacts and the event log rather than persisted stage pointers (`deriveResumePoint` — self-healing when `state.json` drifted from reality):

- A pending gate is loud, not silent: `resume` on a gate-pending run prints that the run awaits a gate decision plus the exact `sdd-runner gate resume <runId>` command, then exits without side effects.
- The review loop counts as settled when a converged verdict is recorded, an early gate was answered by a human (approve = human-decree convergence), or the pipeline already entered decompose (severity convergence).
- Missing `tasks.md` after a settled review → resume at `decompose`; `tasks.md` present at depth ≠ S without a recorded atomicity stage → resume at `atomicity`. Both continuations source the review result from the `resolutions-<round>.json` sidecars (`readReviewResultFromSidecars`) and run the shared post-convergence tail to the final gate, numbered after the highest existing `gate-<n>.md`.
- Stages are idempotent by construction (decompose rewrites `tasks.md` wholesale; atomicity rewrites in place), so a spurious re-run after a crash-between-artifacts is wasted tokens, not corruption.

`continue` is the one routing verb that never fails silently (`continue.ts`): gate-pending → the gate flow (interactive session on a TTY, flag/file handling otherwise); interrupted mid-stage → the `resume` stage path; completed → a pointer to `sdd-runner report <runId>`. Without an id, a single gate-pending run routes directly and several print the per-run gate commands (a picker on TTY, a plain list otherwise) instead of guessing.

### Change digest

Every `gate-<n>.md` carries a `### Change digest` section between `### Summary` (the slug, a stable machine-readable anchor) and `### Cost / duration`, so a human opening the gate can answer "what is this change and what does it touch" in seconds without opening `proposal.md`/`design.md`. It is extract-only (no agent spawn) and pure-additive — the parser, checkbox semantics, and resume contract are unaffected.

The section renders a 5-tuple sourced from existing artifacts (`extractChangeDigest` in `gate-digest-extract.ts`; threaded in by `readChangeDigest` from `presentGateAt`):

| Field   | Source                                          | Tolerance on missing                              |
| ------- | ----------------------------------------------- | ------------------------------------------------- |
| WHAT    | First 1–2 sentences of `proposal.md` `## Why`   | `_(no "Why" section in proposal.md)_`             |
| WHY     | Full `proposal.md` `## Why`                     | `_(no "Why" section in proposal.md)_`             |
| TOUCHES | Bullets under `proposal.md` `## Impact`         | `_(no "Impact" section in proposal.md)_`          |
| RISKS   | Reference to an already-rendered findings block | Mode-aware (see below)                            |
| BLAST   | Reference to the assumptions block              | `_(no assumptions logged)_` when the list is empty |

Mode-aware rendering: at the **early** (cap-hit) gate TOUCHES carries no task line and RISKS points at `### Open MATERIAL findings at cap`; at the **final** gate TOUCHES gains a trailing `tasks: <done>/<total>` entry parsed from `tasks.md` and RISKS points at `### Nitpicks (informational)`. Only ATX headings (`## Why`) are recognized; setext-style headings and empty/malformed sections degrade to a placeholder rather than failing the gate.

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

### Extend directive (`→ RUN 1 MORE`)

At an **early** cap-hit gate the human may write `→ RUN 1 MORE` on its own line. The runner bumps the effective round cap by 1, executes exactly one more review round, and re-presents the gate at `gate-<n+1>.md`. This is **Shape B — extend-and-re-cap**: one decision binds one round of spend; repeated extends require writing the directive again at each successive gate. The directive is rejected at a final gate (post-convergence there is nothing to extend) and only the literal `→ RUN 1 MORE` is accepted — `→ RUN 2 MORE`, `→ RUN MORE`, etc. are rejected with an error naming the line, leaving room for future parameterization without silently accepting typos.

**State** — a new optional `state.roundCap` field defaults to `ROUND_CAPS[depth]` and is bumped by each extend:

```
state.depth     classification (S/M/L) — set once at intake, never mutates
state.roundCap  current ceiling       — starts at ROUND_CAPS[depth], grows on extend
```

The depth profile and the cap are distinct: an M-profile run that extends three times has `state.depth = 'M'` and `state.roundCap = 6`. The depth governs lens escalation (`M gains skeptic when blockers remain after round 2`); the cap only bounds the loop. Overloading `depth` would conflate a classification with a counter and silently change the lens mix.

**Carry-forward** — the extended round reads `resolutions-<state.round>.json` as its prior ledger via the existing `readResolutionsLedger` sidecar mechanics, so already-resolved findings stay resolved. The runner re-enters the review loop at `state.round + 1` with the bumped cap (`runReviewLoop({ startRound, cap })`); rounds already executed are never re-run, so `events.ndjson` and the trajectory block stay append-only.

**Worked example** — an M-profile run cap-hits at round 3:

```
gate-1.md  trajectory: round 1 · round 2 · round 3            (cap = 3)
           ↓ human writes → RUN 1 MORE
gate-2.md  trajectory: round 1 · round 2 · round 3 · round 4  (cap = 4, still cap-hit)
           ↓ human writes → RUN 1 MORE
gate-3.md  trajectory: round 1 · … · round 5                  (cap = 5, converged → final gate)
```

Each extend appends exactly one trajectory row and bumps the cap by 1. When an extended round converges, the run flows into decompose → atomicity → final gate at the same `gate-<n+1>.md` version, exactly as a fresh `runPostReviewToGate` would. The `runGateResume` outcome is `'extend'` with `version: n+1` and the new `gateMdPath`, distinguishing "we ran another round" from approve/veto/abort for the CLI and event log.

### Nitpicks at the final gate

When the loop converges with surviving nitpicks (≤3 NITPICK findings), the final gate lists them under `### Nitpicks (informational)` as plain bullets (gap + resolver outcome). No checkboxes — they are informational only, not a veto surface.

## Commands

```bash
bun run sdd-runner:start -- <task-file> [--depth S|M|L] [--verbosity brief|normal|debug]
bun run sdd-runner:start -- continue [runId]
bun run sdd-runner:start -- resume <runId>
bun run sdd-runner:start -- gate [resume <runId> [--confirm-all] [--extend] [--veto <id>=<redirect>]... [--abort]]
bun run sdd-runner:start -- report <runId> [--pr]
```

`gate resume <runId>` opens the interactive session on a TTY; with decision flags, or on a non-terminal, it acts on flags or the hand-edited gate file alone. Bare `gate` lists pending gates. `continue` routes by run state (gate-pending → gate flow; interrupted mid-stage → stage resume; completed → report pointer).

Or via the thin wrapper: `/sdd:auto <task-file>` _(not yet implemented — intended papai chat command that shells out to `sdd-runner:start`; use the `bun run` form above for now)_.

### Live rendering

`bun run sdd-runner:start` picks its renderer once at harness construction (`index.ts buildHarness(verbosity)`):

- **Dynamic (TTY, `normal`/`debug`)** — `DynamicRenderer` (`sdd-runner/src/live-renderer.ts`) redraws a fixed-position block on every event instead of scrolling. Three zones:
  - **Pipeline map** (top) — the output of `renderPipelineMap(state)`, finally exercised live (it was tested but never called pre-change). One line per stage with `✓ done` / `▶ active (round n/cap)` / `· pending` / `— skipped` markers.
  - **Slot lines** (middle) — one per active agent, driven by the new L0 `tool_use` events: `<agent> ▶ <tool> <arg?>`. Cleared on that agent's `done`.
  - **Status line** (bottom) — `round n/cap · in <tok> / out <tok> · [$|~$]<cost> · <elapsed>`, accumulated from `step_finish` deltas only (the `done` event clears the agent's slot but no longer adds to totals — its `usage` is the sum of the same deltas, so counting both double-counted tokens and cost). Cost is metered (`$`, from `step_finish.costUsd`) unless any estimate contributed, in which case the marker is `~$`: `buildHarness` loads the models.dev pricing DB once (`buildResolveCost()`) and injects the resolver into `DynamicRenderer`, which prices each unmetered step (`costUsd: 0`, tokens > 0) via the agent's `spawned` model using the same `repriceEvent` formula as the gate. Estimation is display-time only — persisted events stay raw, and an unresolvable model or missing DB hides the segment exactly as before.
  The L0 events reach the renderer through a `ProgressReporter` adapter (`agent-reporter.ts`) wired into the `runAgent` call at `agent-layer.ts`; `slot()` parses the review-loop slot line and emits `tool_use`, `usage()` emits `step_finish`, and the other reporter methods are no-ops (the renderer owns the block). ANSI primitives are inlined from `review-loop/src/live-renderer.ts` rather than imported cross-workspace; the `shared-tui-renderer` proposal can consolidate them later.
- **Line (non-TTY / `--verbosity brief`)** — `LineRenderer` (`renderer.ts`), byte-identical to the pre-change append-only output. This is the CI / pipe / log-file contract; the TTY check is hard-gated so a redirect never gets ANSI escapes. The one additive change for both modes: `done` now renders `<agent> done · in <tok> out <tok> · $<cost>` instead of bare `<agent> done`.

`--verbosity` is threaded from the CLI through `StartOptions.verbosity` and `buildHarness(verbosity)` to `createRenderer(stream, verbosity)`. `brief` suppresses L1; `debug` raises the altitude filter to show L0 tool-call/step events as scrolling lines in line mode (the dynamic mode always shows them in the block). Resume/gate/report inherit the harness's construction-time `normal` — those paths produce artifacts, not live progress.

The deleted `--wait` flag and `renderGateScreen` (commit `fe3498040`, "placed for a live-watching TUI future that didn't ship") stay deleted — that was an interactive gate-editor concern, separate from progress rendering. The consumer that prompted re-visiting live output is the operator running `sdd-runner:start` interactively (most often via `/sdd:auto`).
