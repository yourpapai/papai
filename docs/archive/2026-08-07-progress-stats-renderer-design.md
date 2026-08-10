<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Progress & Stats Renderer Upgrade — Design

Date: 2026-08-07
Status: Approved (brainstorming)
Workspaces: `review-loop/`, `mutation-improve/`

## Problem

The live progress output of both runner CLIs is not informative enough: per-step footers (`task ✓ 2s · 3 tools · in 5225 / out 113`) carry no run-level aggregates. There is no overall token i/o, tool-call total, lines added/removed, or estimated cost — and `mutation-improve` prints no end-of-run terminal summary at all (only a PR-body markdown).

## Decision record (from brainstorming)

| Question | Decision |
|---|---|
| Rendering paradigm | Upgrade the existing hand-rolled renderer (scrolling log + persistent live block). No listr2/tasuku/Ink/OpenTUI dependency. |
| Cost | Pricing table in `config.json`; estimated cost computed from token counts; displayed as `~$X est`. (`opencode run` events always report `cost: 0`.) |
| Diff stats | Measured at merge points via `git diff --numstat` (per iteration in mutation-improve; per worker-merge in review-loop). |
| Persistence | Aggregates printed to terminal AND persisted (`state.json` for mutation-improve, `metrics.json` for review-loop); rehydrated on `--resume-run`. |
| Scope | Both workspaces in one effort (renderer is shared via `review-loop/src`). |

## Library research summary

- **listr2** (v11, ~44M dl/wk): full task-tree runner with custom renderers (`ListrBaseRenderer`), bottom bar, persistent output. Rejected: it wants to own task orchestration; both pipelines self-orchestrate (sequential recursive iterations; worker pool), so it would be renderer-only glue against its grain.
- **tasuku**: minimal vitest-like task list; no custom renderers/bottom bar — too thin for stats.
- **cli-progress / spinnies**: progress bars / multi-spinners; wrong fit (runs have no % progress; spinnies unmaintained since 2023).
- **Ink**: React-for-CLI dashboards (Copilot CLI, Wrangler). Rejected as overkill: ~50MB RAM, 32fps rerender loop, non-TTY fallback complexity, new runtime dep for local tooling.
- **OpenTUI**: Bun+Zig native TUI (powers opencode). Rejected: native FFI dep, heaviest lift.
- **blessed**: dated, unmaintained.
- **Chosen**: keep the proven EPIPE-safe, TTY-aware hand-rolled renderer; the actual gap is data aggregation, not rendering primitives.

## Architecture

### New / changed files

| File | Change |
|---|---|
| `review-loop/src/run-stats.ts` | **New.** Pure `RunStats` aggregate (~150 lines). No I/O, no ANSI. |
| `review-loop/src/cost.ts` | **New.** Pricing-table lookup + `estimateCost(model, tokens)`. |
| `review-loop/src/diff-stats.ts` | **New.** `git diff --numstat` parser; reuses existing `execGit` from `worktree.ts`. |
| `review-loop/src/live-renderer.ts` | Extend: holds `RunStats`; status line gains aggregate segments. |
| `review-loop/src/progress-log.ts` | `ProgressReporter` gains optional `stats?: RunStats` and `diff?(label, {added, removed})`. Optional → existing test fakes keep working. |
| `review-loop/src/line-handler.ts` | Step end forwards `toolCount` in addition to usage. |
| `review-loop/src/config.ts` | Zod schema gains optional `pricing` map. |
| `review-loop/src/summary.ts` + `summary-burndown.ts` | Final report gains totals block (tokens, est. cost, tools, +a/-r). |
| `review-loop/src/cli.ts` | Construct `RunStats`, wire model→pricing, rehydrate on resume, persist at end. |
| `mutation-improve/src/summary.ts` | **New.** Terminal run summary (per-iteration outcome table + totals). |
| `mutation-improve/src/run-state.ts` | `state.json` schema gains optional `stats` block. |
| `mutation-improve/src/pipeline.ts` / `cli.ts` | Wire stats through; measure diff at ratchet commit; print summary at end. |

### `RunStats` API

```ts
interface UsageDelta { inputTokens: number; outputTokens: number; reasoningTokens: number; wallMs: number }
interface DiffStats { added: number; removed: number }
interface StatsSnapshot {
  totals: { input: number; output: number; reasoning: number; toolCalls: number; added: number; removed: number; estimatedCostUsd?: number; elapsedMs: number }
  perLabel: Record<string, { input: number; output: number; toolCalls: number; added: number; removed: number }>
}

class RunStats {
  constructor(opts: { startedAt?: number; pricing?: PricingTable; model?: string; rehydrate?: Partial<StatsSnapshot> })
  addUsage(label: string, delta: UsageDelta): void
  addToolCalls(label: string, n: number): void
  addDiff(label: string, diff: DiffStats): void
  snapshot(): StatsSnapshot   // immutable copy
}
```

### Config addition (both workspaces' `config.json`, Zod-validated)

```jsonc
{
  "pricing": {                       // optional; USD per 1M tokens
    "claude-sonnet-*": { "input": 3, "output": 15 },
    "gpt-*":           { "input": 2.5, "output": 10 }
  }
}
```

Matching: glob on the model string resolved once at CLI start (from agent config if present, else opencode default). No match → cost omitted everywhere; never displayed as `$0.00`.

## Data flow

1. **Tokens/cost/tools** — `line-handler.ts` already parses `step_finish` (tokens) and counts unique `callId`s; on step end it now also calls `stats.addUsage(label, …)` / `addToolCalls(label, n)` via the reporter. `RunStats` adds `estCost` per step when pricing matches.
2. **Diff stats** — mutation-improve: in `finalizePhase` after the ratchet commit, `diffStats(base…iterBranch)` → `reporter.diff('iter-N', stats)`. review-loop: in `mergeWorkerIntoPrimary` after merge → `reporter.diff('worker-N', stats)`. Failed/skipped iterations contribute nothing.
3. **Durations** — `RunStats` records run start; footer shows total elapsed; per-label elapsed unchanged.
4. **Footer** — `LiveRenderer.statusLine()` appends aggregate segments from `stats.snapshot()`: `in <k> / out <k> · ~$X est · tools N · +a/-r`.
5. **Persistence** — at run end: mutation-improve merges `stats.snapshot()` into `state.json` (`stats` block, optional in schema for old-run compat); review-loop adds `diffStats`, `estimatedCostUsd`, `toolCalls` to `metrics.json`. On `--resume-run`, snapshot rehydrates from the artifact so totals accumulate.

## Output shape

Live footer (TTY only, single persistent line):

```
  status    round 2/4 · review ×1 · fix ×2 · 4m12s · issues: 3 open · in 228.8k / out 41.2k · ~$1.02 est · tools 37 · +412/-87
```

Final summary (both CLIs; new for mutation-improve):

```
Run summary (mutation-improve-13, 3 iterations, 12m40s)
  file                          before   after   outcome    tokens (in/out)   lines
  src/tools/registry.ts          61.2%   78.4%   improved   98.2k / 12.1k     +301/-12
  src/chat/router.ts             55.0%   66.7%   capped     74.1k / 9.8k      +111/-75
  ─────────────────────────────────────────────────────────────────────────────────
  totals                                             228.8k / 41.2k   +412/-87   ~$1.02 est
```

Non-TTY: no per-tick footer (unchanged); stats appear only in the final summary + artifacts.

The footer's leading activity segments remain CLI-specific (review-loop: `round N/M · issues: N open`; mutation-improve: `iter N/M · current phase`); only the new trailing aggregate segments (`in/out · ~$ est · tools · +a/-r`) are shared.

## Error handling

- **EPIPE/broken stream**: `RunStats` accumulates independently of stream state; existing `writeSafe` permanent downgrade preserved; summary still persisted (printed best-effort).
- **numstat failure** (missing base, detached HEAD, binary-only diff): warn via `reporter.event()`, contribute `+0/-0`, never fail merge/run. Binary numstat lines (`-\t-`) parse as zero.
- **Pricing**: no match → cost segments omitted; malformed `pricing` → Zod startup error.
- **Resume**: artifacts lacking stats → rehydrate as zeros.
- **Parse gaps**: missing token fields → 0; NaN/negative clamped.

## Testing (test-first per workspace TDD hooks)

- `tests/review-loop/run-stats.test.ts` — accumulation, snapshot immutability, rehydrate, clamping.
- `tests/review-loop/cost.test.ts` — glob match, no-match → undefined, accumulation, rounding.
- `tests/review-loop/diff-stats.test.ts` — numstat parsing (normal / binary / rename), failure → zero + warn.
- `tests/review-loop/live-renderer.test.ts` (extend) — footer segments, cost hidden when unpriced, non-TTY silence, EPIPE downgrade still accumulates.
- `tests/review-loop/line-handler.test.ts` (extend) — step end forwards usage + toolCount.
- `tests/mutation-improve/integration.test.ts` (extend) — `state.json` gains `stats`; terminal summary printed with totals.
- review-loop integration — `metrics.json` gains new fields; summary includes totals.

## Out of scope

- No new runtime dependencies.
- No full-screen TUI, no interactivity (keyboard), no progress bars.
- No changes to `scripts/mutation/` output.
- Harness elision (`[N lines elided]`) is external to these CLIs and unchanged.
