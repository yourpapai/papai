## Context

See `proposal.md` — Why. The renderer is append-only; the L0 event schemas (`events.ts:38-56`) and renderer handlers (`renderer.ts:71-72`) exist but no code emits them; `--verbosity` is parsed but discarded; `review-loop` has the dynamic-TUI engine sdd-runner doesn't reuse.

Two existing modules define the seams:

1. **`review-loop/src/agent-runner.ts:71`** — `RunAgentOptions.reporter?: ProgressReporter`. Sdd-runner's call at `agent-layer.ts:140` omits it.
2. **`review-loop/src/progress-log.ts:24-36`** — `ProgressReporter` interface. The relevant methods for sdd-runner are `slot(key, line)` (per-tool activity line, label-scoped) and `usage(delta)` (token+cost delta per step). `event(message)` is the catch-all scrolling line.

The `review-loop/src/live-renderer.ts:58-249` `LiveRenderer` implements `ProgressReporter` with a dynamic TTY block. Its primitives are: ANSI escapes (`ERASE_LINE`, `CURSOR_DOWN`, `cursorUp` at `live-renderer.ts:12-17`), `writeBlock`/`clearBlock`/`writeSafe`/`fit` (lines 210-248), slot map + status line + usage accumulator (lines 69-198), EPIPE downgrade via `broken` flag (lines 236-243).

## Goals / Non-Goals

**Goals:**

- G1. Emit `tool_use` and `step_finish` L0 events for every spawned agent, by wiring a `ProgressReporter` adapter into the existing `runAgent` call.
- G2. Thread `--verbosity` from the CLI to the renderer so the altitude filter is reachable.
- G3. Provide a dynamic TTY renderer that redraws a fixed-position block (pipeline map + current slot + status line) instead of scrolling every line, with a clean fallback to append-only on non-TTY / `brief`.
- G4. Render the existing `DoneEvent.usage` field instead of dropping it.

**Non-Goals:**

- N1. No `--wait` re-introduction (separate concern; explicitly deleted in `fe3498040`).
- N2. No `shared-tui-renderer` workspace extraction. The dynamic block primitives are duplicated into `sdd-runner/src/live-renderer.ts`. The shared-tui-renderer proposal can consolidate later.
- N3. No changes to `events.ts` schemas (L0 variants already defined).
- N4. No `budgetUsd` enforcement (display only).
- N5. No re-architecture of the append-only mode — it remains the non-TTY / CI fallback byte-identical to today's output.

## Decisions

### D1. The adapter is a thin translator, not a renderer

**Decision.** `agent-reporter.ts` exports `createAgentReporter(label: string, emit: (event: EventInput) => void): ProgressReporter`. It implements the full interface but only two methods carry data:

- `slot(key, line)` — if `line` is non-null, parse the tool name and argument from the slot line (the format from `review-loop/src/live-format.ts:78-82` is `reviewer ▶ grep foo · 12s · 3 tools`) and emit `{ altitude: 'L0', type: 'tool_use', agent: label, tool, arg }`. If `line` is null, no-op (slot cleared — agent finished).
- `usage(delta)` — emit `{ altitude: 'L0', type: 'step_finish', agent: label, tokens: { input, output, reasoning }, costUsd: delta.cost }`.

Other methods are no-ops: `event`, `log` (already covered by the agent's own lifecycle emits), `live`/`clearLive` (sdd-runner's renderer drives its own slot block from the event bus, not from the reporter's slot imperative), `diff`, `issue`. `dynamic` returns `false` so `withLivePhase` falls back to its non-ticking path.

**Rationale.** The event bus is the single source of truth for sdd-runner rendering. Routing reporter calls directly to a renderer would create a second, parallel display path. Translating to events keeps one bus, one renderer, one persistence path (`events.ndjson` gains L0 rows that replay ignores for `ReplayState` but a future renderer can read).

**Alternatives considered.**

- *Pass a real `LiveRenderer` instance to `runAgent`.* Rejected: the `LiveRenderer` would write directly to the stream, bypassing sdd-runner's event bus and `events.ndjson` persistence. Two display paths. Also, `LiveRenderer` carries review-loop-specific counters (`counts.open/fixed/rejected/needsHuman`) that don't map to sdd-runner concepts.
- *Extend `RunStageAgentOptions` with an optional `reporter`.* Rejected: the adapter is always the same per spawn (label + emit), so constructing it at the call site is simpler than threading an option.

### D2. Pick renderer at construction time, not per-event

**Decision.** `createRenderer(stream, verbosity, opts?)` returns a `Renderer` (same shape as today). Internally:

- If `opts?.dynamic === true` AND `stream.isTTY === true` AND `verbosity !== 'brief'` → return a `DynamicRenderer`.
- Else → return a `LineRenderer` (the current implementation, refactored to a class).

`opts.dynamic` defaults to `true`. CI / non-TTY / `--verbosity brief` always get `LineRenderer`. The output of `LineRenderer` is byte-identical to today's `createRenderer` output (asserted by an existing test that we'll keep green).

**Rationale.** The renderer is constructed once per run in `buildHarness` (`index.ts:98`). Per-event branching adds complexity with no benefit — the choice is stable for the run lifetime. TTY detection happens once at construction.

### D3. The dynamic block layout

**Decision.** Three zones, top to bottom, redrawn on each event:

```
✓ intake done
✓ draft done
▶ review active (round 2/3)
· decompose pending
· atomicity pending
· gate pending
  resolver-r2 ▶ readFile sdd-runner/src/agent-layer.ts · 4s · 7 tools
  status       round 2/3 · in 18k / out 2.4k · $0.0142 est · 142s
```

- **Pipeline map** (top): the output of the existing `renderPipelineMap(state)` (`renderer.ts:26-35`), driven by a `ReplayState` rebuilt on each event via `createReplayFolder` (already in `renderer.ts:86`). Today this function exists, is tested, and is never called — G3 makes it the dynamic block's header.
- **Slot line** (middle): the most recent `tool_use` event per agent label (`{agent} ▶ {tool} {arg?}`). Cleared on `done` for that agent. Multiple concurrent agents (reviewer + skeptic in L profile, `p-limit(2)` at `review-loop.ts:128`) each get a slot line.
- **Status line** (bottom): elapsed time, current stage + round, token totals, cost accumulator. The cost accumulator sums `DoneEvent.usage.costUsd` and `StepFinishEvent.costUsd` seen so far.

The block redraws on every event the renderer is subscribed to (the same `renderEvent(event)` entry point). The line-scrolling behavior of `LineRenderer` is replaced by `clearBlock` + `writeBlock` (inlined from `review-loop/src/live-renderer.ts:210-248`).

**Rationale.** Three zones map cleanly to the three event altitudes: L2 → pipeline map (stage transitions), L0 → slot line (tool calls), L1+L0 → status line (done events for usage, step_finish for incremental cost). No new event variants needed.

**Alternatives considered.**

- *Adopt `LiveRenderer` directly.* Rejected in D1.
- *Use `review-loop`'s `withLivePhase` to wrap each `runStageAgent` call.* Rejected: `withLivePhase` ticks a slot for one phase; sdd-runner's natural unit is the pipeline, not the individual agent spawn. The status line should be pipeline-scoped.

### D4. ANSI primitives duplicated, not imported

**Decision.** `sdd-runner/src/live-renderer.ts` defines its own `ERASE_LINE`, `CURSOR_DOWN`, `cursorUp`, `RendererStream`, `writeBlock`, `clearBlock`, `writeSafe`, `fit`, `truncate`. The shape mirrors `review-loop/src/live-renderer.ts:12-248` (and `live-format.ts`'s `formatDuration`, `formatTokenCount`, `MIDDLE_DOT`) but lives independently under sdd-runner.

**Rationale.** Importing across the `review-loop/` workspace boundary for four ANSI escapes plus a writeBlock method creates a layering inversion: sdd-runner already depends on review-loop for `runAgent` (functional), but pulling display primitives extends that dependency into presentation. The `shared-tui-renderer` proposal exists to do this extraction properly; landing it first would block this change on a stuck proposal. Duplicating ~30 lines of ANSI code unblocks G3 now and gives `shared-tui-renderer` a concrete second consumer to consolidate against when it lands.

### D5. Verbosity threads through `StartOptions`, not env

**Decision.** `StartOptions` (`orchestrator.ts:41-44`) gains `readonly verbosity?: Verbosity`. `main` (`cli.ts:21-23`) passes `cmd.verbosity` to `harness.runStart({ taskFile, depthOverride, verbosity })`. `buildHarness` in `index.ts` accepts `verbosity` and constructs `createRenderer(process.stdout, verbosity)` accordingly. The `verbosity` lives on the start path; `resume` / `gate` / `report` don't accept it (they inherit the harness's construction-time value, which is `normal` — those paths produce machine-readable or post-hoc output, not live progress).

**Rationale.** Verbosity is a property of how the operator wants to watch *this run start*. Resume/gate/report are short operations or produce artifacts; a verbosity flag there adds surface area with no value. Matching `--depth` (which also lives on start) keeps the surface consistent.

**Alternative considered.** Add verbosity to `OrchestratorDeps` so all paths see it. Rejected: `OrchestratorDeps` is constructed once and shared across runs in tests; per-run verbosity would require rebuilding the deps or threading a separate field. Start-only is simpler.

### D6. `LineRenderer` output stays byte-identical

**Decision.** The current `createRenderer` body becomes `LineRenderer.renderEvent`. The existing `tests/sdd-runner/renderer.test.ts` cases (lines 39-130 of the current file, covering `renderPipelineMap`, `formatEvent`, `formatBurndownLine`, and the append-only `renderEvent` flow) stay green unchanged. The only `renderer.ts` behavior change for `LineRenderer` is `DoneEvent` rendering: `'${event.agent} done'` becomes `'${event.agent} done · in ${formatTokenCount(inputTokens)} out ${formatTokenCount(outputTokens)} · $${costUsd.toFixed(4)}'`. That assertion is updated in the existing test (one-line delta).

**Rationale.** The line-mode output is the CI / pipe / log-file contract. Breaking it would change every captured test fixture and break downstream parsers (e.g. `tests/scripts/story-enforcement-imports.test.ts` and any operator log scraping). The one change (usage on done) is additive and matches the L0 handler's existing intent.

## Risks / Trade-offs

- **[Dynamic renderer mangles output on non-TTY streams]** A pipe or file redirect gets ANSI escapes → garbage in log files. → *Mitigation*: D2's TTY check is hard-gated; `stream.isTTY !== true` always produces `LineRenderer`. Test fixture writes to an in-memory stream with `isTTY: true` explicitly; production never guesses.
- **[EPIPE on broken pipe]** `process.stdout` to a closed downstream throws `EPIPE`. → *Mitigation*: the inlined `writeSafe` (mirroring `live-renderer.ts:236-243`) catches and sets `broken = true`; subsequent renders no-op. The run continues; events still persist to `events.ndjson`. Same behavior as review-loop.
- **[L0 event spam inflates `events.ndjson`]** Every tool call now writes a JSON row. A long run with 1000 tool calls adds ~1000 lines (~150KB). → *Mitigation*: acceptable — `events.ndjson` is per-run and gitignored. If it ever matters, add an altitude filter at the persistence layer (separate change).
- **[Slot line parsing is brittle]** The adapter parses `review-loop/src/live-format.ts:78-82`'s slot format (`reviewer ▶ grep foo · 12s · 3 tools`). If review-loop changes that format, the `tool_use` event's `tool` field degrades to `(unknown)` but the run continues. → *Mitigation*: the adapter uses a tolerant regex with optional fallbacks; one unit test pins the parse for the documented shape and one for an unrecognized shape.
- **[Dynamic renderer cost vs. value]** The dynamic block adds ~250 lines of new code in `sdd-runner/src/live-renderer.ts`. If it ends up unused in practice (operators always piping to logs), it's dead surface. → *Mitigation*: the `LineRenderer` is the default for non-TTY; the dynamic path only fires on a real terminal. The renderer test fixtures cover both branches so the dynamic path can't bit-rot silently.
- **[Cost always `$0.00` for glm-5.2]** Deferred Thread C1 (`sdd-runner-cap-hit-fidelity/design.md:136-141`) — the model doesn't populate `costUsd`, so the status line shows `$0.0000 est` regardless. → *Mitigation*: out of scope. The status line still shows tokens and elapsed time, which glm-5.2 *does* populate. The rendering change is independent of the cost-source change.

## Migration Plan

No data migration. `events.ndjson` gains L0 rows that the schema already accepts; old logs replay cleanly (replay's `ReplayState` derivation ignores L0). Operators running `bun run sdd-runner:start` interactively on a TTY automatically get the dynamic renderer; CI / pipe / `--verbosity brief` runs see byte-identical output to today (modulo the `done` line gaining a usage suffix). Rollback: `git revert`. No deployed artifacts, no production state.

## Hook/TDD Interactions

New code files the Write/Edit TDD hook pipeline will gate:

- `sdd-runner/src/agent-reporter.ts` (new) — test-first in `tests/sdd-runner/agent-reporter.test.ts`: failing test for `createAgentReporter(label, emit)` returning a `ProgressReporter` whose `slot()` emits `tool_use` and `usage()` emits `step_finish`, with no-op coverage for other methods.
- `sdd-runner/src/live-renderer.ts` (new) — test-first in `tests/sdd-runner/live-renderer.test.ts`: failing test for `DynamicRenderer.renderEvent` producing an in-place block redraw on an in-memory stream with `isTTY: true`, and falling back to line-mode when `isTTY: false`.

Modified code files (existing tests must stay green):

- `sdd-runner/src/renderer.ts` — split into `LineRenderer` + picker. Existing `renderer.test.ts` stays; add coverage for the picker and the `DoneEvent` usage rendering.
- `sdd-runner/src/agent-layer.ts` — wire the reporter at the `runAgent` call. The `agent-layer.test.ts` suite already uses fake spawns; extend to assert the reporter is constructed and would be passed (the existing test infrastructure doesn't exercise real `runAgent`, so this becomes a structural assertion about the call site).
- `sdd-runner/src/index.ts` / `sdd-runner/src/orchestrator.ts` — thread verbosity. Extend `orchestrator.test.ts` and `cli.test.ts`.

Test order: agent-reporter unit tests → live-renderer unit tests → renderer split + DoneEvent usage → agent-layer wiring → CLI/orchestrator threading → end-to-end smoke (manual, with `--verbosity debug` against a live run).
