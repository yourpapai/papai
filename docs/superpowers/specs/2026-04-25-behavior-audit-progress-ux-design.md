# Behavior Audit Progress UX

Date: 2026-04-25

## Problem

When `VERBOSE=0` (the default), the behavior-audit script produces sparse line-by-line output: file names, test names, elapsed time, and a checkmark. Token usage, tool-call activity, throughput, and aggregate statistics are invisible. The only alternative is `VERBOSE=1`, which dumps noisy pino JSON debug logs.

## Goal

At `VERBOSE=0`, show per-item token counts, tok/s throughput, and tool-call counts inline, followed by a structured stats summary after each phase.

## Approach

Compact inline stats + block summary (Approach A from evaluation). No ANSI escape codes, no live-updating spinner. Output scrolls naturally and works in pipes, CI, and log captures.

## Design

### Data types

`AgentUsage` carries per-call token and tool metrics:

```ts
interface AgentUsage {
  inputTokens: number
  outputTokens: number
  toolCalls: number
  toolNames: string[]
}
```

`AgentResult<T>` wraps the existing result with usage:

```ts
interface AgentResult<T> {
  result: T
  usage: AgentUsage
}
```

Both defined in `scripts/behavior-audit/phase-stats.ts`.

`PhaseStats` accumulates across items within a phase:

```ts
interface PhaseStats {
  itemsDone: number
  itemsFailed: number
  itemsSkipped: number
  totalInputTokens: number
  totalOutputTokens: number
  totalToolCalls: number
  toolBreakdown: Record<string, number>
  wallStartMs: number
}
```

### Accumulation API

`scripts/behavior-audit/phase-stats.ts` exports:

- `createPhaseStats(): PhaseStats` — sets `wallStartMs = performance.now()`
- `recordItemDone(stats, usage)` — increments itemsDone, adds tokens, adds tool counts
- `recordItemFailed(stats, usage?)` — increments itemsFailed, adds partial usage if available
- `recordItemSkipped(stats)` — increments itemsSkipped
- `formatPhaseSummary(stats, label): string` — renders the block summary string

### Agent return type changes

Each agent function changes from returning `T | null` to `AgentResult<T> | null`.

| File                        | Function                    | New return type                                                                                                         |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `extract-agent.ts`          | `extractWithRetry`          | `AgentResult<ExtractionResult> \| null`                                                                                 |
| `keyword-resolver-agent.ts` | `resolveKeywordsWithRetry`  | `AgentResult<ResolverResult> \| null`                                                                                   |
| `classify-agent.ts`         | `classifyBehaviorWithRetry` | `AgentResult<ClassificationResult> \| null`                                                                             |
| `consolidate-agent.ts`      | `consolidateWithRetry`      | `AgentResult<readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[]> \| null` |
| `evaluate-agent.ts`         | `evaluateWithRetry`         | `AgentResult<EvalResult> \| null`                                                                                       |

Each agent's inner `*Single()` function reads `result.totalUsage` from the AI SDK's `generateText` return value, collects tool names from `result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName))`, and builds the `AgentUsage`. On retry, usage from all attempts accumulates.

### Per-item rendering format

Each completed item renders on one line:

```
  [N/M] "item name" — K tools, X tok in T (TPS tok/s) ✓
```

Failed items show `✗` with whatever tokens were consumed before failure. Skipped or reused items show no token line (no LLM call was made):

```
  [N/M] "item name" (reused)
  [N/M] "item name" (skipped, max retries reached)
```

Phase-specific examples:

Phase 1 (extract):

```
[Phase 1] 1/23 — tests/bot.ts
  [1/5] "handles group messages" — 3 tools, 1,847 tok in 4.2s (440 tok/s) ✓
```

Phase 2a (classify):

```
  [1/47] "bot > handles group messages" — 2 tools, 934 tok in 3.0s (311 tok/s) ✓
```

Phase 2b (consolidate):

```
  [1/12] "group-message-handling" — 4 tools, 3,201 tok in 8.1s (395 tok/s) ✓
```

Phase 3 (evaluate):

```
  [1/30] chat :: "group message handling" — 5 tools, 4,102 tok in 9.3s (441 tok/s) ✓
```

### Phase summary block

Rendered after each phase completes:

```
Phase 1 complete — 23 files, 47 behaviors extracted, 2 failed
  Wall: 4m 32s | Avg: 392 tok/s
  Tokens: 89,421 in / 12,847 out
  Tools: 142 calls (readFile: 89, grep: 53)
```

Format rules:

- **Line 1:** Phase label, domain-specific done count, failures
- **Wall:** `Xm Ys` format (seconds only if under a minute)
- **Avg tok/s:** `totalOutputTokens / wallSeconds` rounded to nearest integer
- **Tokens:** comma-separated, in/out on one line
- **Tools:** total count + breakdown by tool name in descending order

### Orchestrator integration

`scripts/behavior-audit.ts` creates a fresh `PhaseStats` before each phase call and passes it through the phase runner deps. After each phase completes, it calls `formatPhaseSummary` and logs the result.

Phase 1 items make two agent calls (`extractWithRetry` + `resolveKeywordsWithRetry` via `resolveKeywords`). The per-item line and `PhaseStats` accumulation use combined usage from both calls. `extractAndSave` in `extract.ts` sums the two `AgentUsage` objects before rendering the per-item line and calling `recordItemDone`.

### VERBOSE=1 behavior

Unchanged. Pino debug logging continues as-is. The new stats are additive at VERBOSE=0 only.

## Files changed

### New file

- `scripts/behavior-audit/phase-stats.ts` — types, accumulation functions, formatting

### Modified — agents (return type change)

- `extract-agent.ts`
- `keyword-resolver-agent.ts`
- `classify-agent.ts`
- `consolidate-agent.ts`
- `evaluate-agent.ts`

### Modified — phase runners (unwrap result, accumulate stats, render)

- `extract.ts`
- `classify.ts`
- `consolidate.ts`
- `evaluate.ts`
- `extract-phase1-helpers.ts` — `resolveKeywords` returns `{ keywords: readonly string[]; usage: AgentUsage } | null` instead of `readonly string[] | null`

### Modified — orchestrator

- `scripts/behavior-audit.ts` — creates `PhaseStats` per phase, passes through deps

### Not changed

- `agent-helpers.ts` — `verboseGenerateText` already returns the full AI SDK result
- `config.ts` — no new config
- `progress.ts` — no progress file format changes
- `tools.ts` — no changes

## Test impact

- Agent tests: update assertions from `result.field` to `result.result.field`
- Phase runner tests: provide `PhaseStats` in deps, update output assertions
- New: unit tests for `phase-stats.ts` accumulation and formatting
