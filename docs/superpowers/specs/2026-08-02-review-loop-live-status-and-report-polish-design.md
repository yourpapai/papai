<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-loop live status line + report polish

Date: 2026-08-02
Status: approved (design)
Scope: `review-loop/` workspace — live in-run rendering (`live-renderer.ts`, `line-handler.ts`, `progress-log.ts`) and final report fixes (`summary.ts`, `summary-burndown.ts`, `cli.ts`).
Follow-up to: `2026-08-01-review-loop-report-output-design.md` (verdict-first report + issue event seam, landed).

## Problem

Observed on a real 27-minute run (pool 3, output piped through `bun run --filter`):

- **No persistent status line in practice.** The status suffix from the previous spec exists, but (a) it only renders on a TTY, and (b) with pool > 1 every worker writes to the same single live-line slot, clobbering each other's tool lines. The information a user glances at during a long run — current phase, elapsed wall time, tokens so far — is absent entirely.
- **Non-TTY mode is noisy.** `dynamic === false` makes `live()` print a full progress line on *every* tool call of every worker. A 27-minute run produced ~190 lines, most of them redundant live lines; the harness elided 188 of them.
- **Report defects:**
  - Burndown header is a hand-written literal whose column widths don't match the `padEnd` row widths — every data column sits one space left of its header.
  - `Cost: $0.000` is printed next to 228k input tokens: opencode reports `cost: 0` in every `step_finish` event (verified: all 90 events in the run's `agent-output.log`), so the figure is always wrong-looking. Token counts are printed as raw digits (`228819`), hard to scan.
  - All-zero burndown rows (a round that found and decided nothing) are printed whenever the run has more than one round.
  - `Duration` is the sum of `phaseMs` only (24m35s) while wall clock was 27m42s; ~3 minutes of setup/match/teardown is invisible.

## Approach

Extend the seam-based design that landed yesterday (chosen over extracting a separate `StatusBoard` state module — that would re-architect fresh code for no user-visible gain, and over report-only fixes — the user explicitly wants the persistent status line):

1. `ProgressReporter` gains two optional methods: `slot(key, line | null)` for per-activity live lines and `usage(delta)` for token accumulation.
2. `LiveRenderer` renders a multi-line live area: a persistent **status line** on top plus one line per active activity (worker/agent) below, redrawn atomically.
3. Non-TTY mode: `slot()` is a no-op; piped output keeps only phase logs, step footers, and issue lines.
4. Final report: burndown alignment, cost-hidden-when-zero, thousands separators, zero-row suppression, wall-clock duration.

## Live area rendering

TTY layout — status line always the top line of the live block, activities below in insertion order:

```
  status     round 1/2 · fix×2 · 15m02s · issues: 1 open · in 228.8k / out 9.8k
  fixer-w1   ▶ edit issue-format.ts · 1m03s · 7 tools
  fixer-w2   ▶ bash bun test · 42s · 12 tools
```

### The seam

```ts
// ProgressReporter gains (both optional — existing fakes don't break):
slot?(key: string, line: string | null): void
usage?(delta: { input: number; output: number; reasoning: number; cost: number }): void
```

- `issue()`, `statusSuffix()`, `live()`, `clearLive()`, `event()`, `log()` are unchanged as interface members. After the rework nothing outside `LiveRenderer` calls `live()`; it stays on the interface for compatibility.
- Slot keys are the agent labels already in use — `reviewer`, `matcher`, `fixer-w1`, `fixer-w2-retry`, `inspector-w2`, `build` — unique per concurrent activity, so no new keying scheme is needed.

### `LiveRenderer` state and redraw

New state: `startedAt` (set on first event/slot, drives elapsed), `usage` totals, `slots: Map<string, string>` (insertion-ordered). Existing round/issue counters unchanged.

- `slot(key, line)`: set/update/delete the slot, then redraw the whole block (status line + all slot lines). Multi-line redraw: track the rendered line count; on update emit `ESC[<n-1>A` (cursor up) then clear+rewrite each line. `clearLive()` clears all lines of the block.
- `event(message)`: clear the block, write `message\n`, redraw the block below — the status line stays persistent at the bottom edge of the scrollback while history scrolls above it.
- `usage(delta)`: accumulate totals; no immediate redraw (the next slot update or tick picks it up).
- **Non-TTY** (`dynamic === false`): `slot()` is a no-op. `event()`/`log()`/`issue()` print exactly as today. Footers, phase logs (`[round 1/2] Reviewing...`), and issue lines still reach piped output; per-tool live lines do not.

### Status line content

Zero-value segments are omitted (same rule as `statusSuffix()` today):

```
  status     round 1/2 · fix×2 · 15m02s · issues: 1 open · in 228.8k / out 9.8k
```

- `round X/Y` — from the existing round event.
- **Activity summary** — derived from active slot keys: strip the `-w<N>` / `-retry` suffixes, map to verbs (`reviewer→review`, `matcher→match`, `fixer→fix`, `inspector→inspect`, `build→build`), join with `+` and count duplicates (`fix×2`). Omitted when no slots are active.
- Elapsed — wall time since the renderer's first event, ticking once per second while any slot is active.
- `issues: N open · M fixed · …` — existing counters, zero segments omitted.
- `in <k> / out <k>` — compact k-formatted cumulative tokens (`228.8k`, `9.8k`); reasoning and cost omitted from the live line (cost is always 0 from opencode today; tokens are the useful proxy).

### Wiring changes

- `line-handler.renderLive` calls `reporter.slot?.(ctx.label, formatLiveLine(...))` instead of `reporter.live([...])`; `dispose()` calls `reporter.slot?.(ctx.label, null)`. The per-second timer and tool-use trigger are unchanged. `formatLiveLine` keeps its current shape minus the status suffix parameter (status now lives on its own line).
- `line-handler` on `step_finish` calls `reporter.usage?.({ input, output, reasoning, cost })` before printing the footer (footer format unchanged).
- `withLivePhase` (used for the build check) writes its tick to `reporter.slot?.(label, …)` and clears the slot in `finally`; the `[label] running...` event stays.

## Final report fixes

Same overall shape as the previous spec; only these changes:

- **Burndown alignment** — column widths become a single shared constant array in `summary-burndown.ts`; header and rows are both generated from it. Off-by-one drift becomes structurally impossible.
- **Zero-activity rows dropped** — a round row with `newIssues === 0` and all decision counters 0 is omitted. If no rows remain, the `Burndown:` block is omitted (extends the existing single-all-zero-round suppression). Round numbers in the header column may skip; that's fine.
- **Cost hidden when zero** — `usage.costUsd > 0` → `· Cost: $1.234 (in 120,000 / out 8,000 / reasoning 3,000)`; otherwise the segment reads `· Tokens: in 228,819 / out 9,824 / reasoning 49,844`. Thousands separators via `toLocaleString('en-US')` in both variants.
- **Wall clock** — `SummaryInput` gains `wallMs: number`. `runCli` timestamps around `executeReviewLoop` and passes it through `writeRunArtifacts`. Timing line becomes:

```
Duration: 27m42s wall · phases 24m35s (review 909.5s, match 40.2s, verify 525.7s) · Tokens: in 228,819 / out 9,824 / reasoning 49,844
```

`metrics.json` schema is unchanged (phase sums stay as they are; wall time is console/summary.txt-only).

## Error handling

- All renderer stream writes are wrapped: on `EPIPE` or any write throw, the renderer permanently downgrades to non-dynamic and swallows the error. A broken pipe must never kill a multi-hour run.
- Report builders stay pure formatting over in-memory data — no new failure modes. Existing `metrics.json` warn-and-continue behavior is unchanged.

## Testing

TDD per workspace rules (`review-loop/src/**` gates against `tests/review-loop/**`):

- **`live-renderer.test.ts`** (extend): slot set/update/clear; multi-line redraw byte sequence (cursor-up counts match rendered line count); `event()` interleaving (block clears → message prints → block redraws); status line segment composition (round, activity verbs with `×N`, elapsed, issues, k-formatted tokens; zero-omission per segment); `usage()` accumulation; non-TTY `slot()` no-op; EPIPE downgrade.
- **`line-handler.test.ts`** (extend): `step_finish` forwards a `usage()` call with the step's tokens; `dispose()` clears the label's slot.
- **`summary-burndown.test.ts`** (new or extended): header and row cell boundaries are identical; zero-activity rows dropped; table omitted when all rows dropped.
- **`summary.test.ts`** (extend): cost>0 vs cost=0 timing-line variants; thousands separators; wall-time rendering; `metrics.json` shape unchanged.
- Loop-level fake reporters that don't implement `slot`/`usage` must keep passing unchanged (both methods optional).

## Out of scope

- Verdict wording changes (`done — …` stays as specified in the previous spec).
- Cost estimation from a model pricing table.
- Colors, hyperlinks, sound, notifications.
- `metrics.json` / trace schema changes; new CLI flags (everything is default-on).

## Rollout

Single change-set: live-area rework + report fixes land together, no flags. Output-only change; safe to default-on.
