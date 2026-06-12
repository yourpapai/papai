<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0147: Stats Global — LLM Totals + main/small Split

## Status

Implemented

## Date

2026-05-23

## Context

The `/stats/global` endpoint provided aggregate counts for subjects, active
users, storage, identity mix, surface mix, web fetches, and tool calls — but
no visibility into LLM call volume or token consumption. The admin Overview
surface rendered four KPI cards (subjects, active, tool calls, storage) and
operators had no at-a-glance indicator of how heavily the LLM was being used
or how the main/small/embedding call split distributed.

`llm_usage_events` already records every LLM turn with `model_role`
(`main` | `small` | `embedding`), `inputTokens`, and `outputTokens`. The
data existed; it simply was not surfaced in the global aggregate or the
admin UI.

The anonymity contract for `/stats/*` permits counts and token sums but
prohibits returning free-form model names, user IDs, or response text.
Grouping by the `model_role` enum (not the `model` text column) satisfies
this contract: the `model` column is read internally for the GROUP BY but
never returned to the client.

## Decision Drivers

- **Observability**: Operators need a top-line LLM call count on the admin
  Overview without drilling into per-subject billing.
- **Anonymity contract**: No free-form strings (model names, user IDs) may
  leave `/stats/*`; only enum-grouped counts and numeric sums.
- **Consistency**: The new aggregator must follow the same sync Drizzle
  pattern and windowing (`1d`/`7d`/`30d`/`all`) as existing global
  aggregators.
- **Graceful degradation**: The client must render a placeholder (em-dash)
  when `llmUsage` is absent from older API responses.
- **Minimal scope**: Per-subject LLM splits and cost/provider dimensions
  are out of scope; those belong to the existing billing aggregator.

## Considered Options

### Option A: Add `llmUsage` to `GlobalStats` with role-grouped counts (chosen)

New `LlmUsageGlobal` type (`totalCalls`, `mainCalls`, `smallCalls`,
`embeddingCalls`, `inputTokensTotal`, `outputTokensTotal`). Sync Drizzle
aggregator in `src/stats/global-llm.ts`, GROUP BY `model_role`. Render as
a fifth Overview KPI with `N main · N small` sub-label.

- **Pros**: Simple sync query; fits existing aggregator pattern; satisfies
  anonymity contract; small diff surface.
- **Cons**: No trend/sparkline data; no per-model or per-cost breakdown.

### Option B: Return raw per-model call counts

Group by the `model` text column and return each model's call count.

- **Pros**: More granular; could support per-model sparklines.
- **Cons**: Violates the anonymity contract — model names are free-form
  strings that may contain proprietary or identifying information.

### Option C: Compute only total calls, omit role split

Return only `totalCalls` and token totals; skip `mainCalls`/`smallCalls`/
`embeddingCalls`.

- **Pros**: Simplest possible aggregator.
- **Cons**: Operators lose the most actionable signal (main vs small ratio
  indicates whether the small-model fallback is effective).

## Decision

**Option A.** Extend `GlobalStats` with an `llmUsage: LlmUsageGlobal` field
populated by a new sync Drizzle aggregator that GROUPs `llm_usage_events`
by `model_role`. The client Zod schema marks `llmUsage` as `.optional()` so
older API responses degrade gracefully. The Overview surface gains a fifth
KPI card (`llm calls`) with the total as the primary value and an
`N main · N small` sub-label.

| Topic             | Decision                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| Grouping column   | `model_role` (enum) only; `model` text column used in GROUP BY but never returned      |
| Window support    | Same `1d`/`7d`/`30d`/`all` windows as all other global aggregators                     |
| Null token fields | `COALESCE(SUM(…), 0)` ensures null `inputTokens`/`outputTokens` contribute zero        |
| Client schema     | `llmUsage` is `.optional()` in the Zod schema; KPI card renders em-dash when absent    |
| KPI card position | Fifth card in the Overview grid (subjects, active 30d, llm calls, tool calls, storage) |
| Grid layout       | Expanded from 4 to 5 columns                                                           |

## Consequences

### Positive

- Operators can see LLM call volume at a glance without per-subject
  drilling.
- The main/small split immediately reveals whether the small-model fallback
  is carrying its share of traffic.
- Token totals (`inputTokensTotal`, `outputTokensTotal`) give a coarse
  cost indicator.
- Anonymity contract preserved: only enum-grouped counts and numeric sums
  leave the boundary.

### Negative

- No trend over time; operators must switch windows (1d/7d/30d) manually.
- Embedding calls are counted but not shown in the sub-label (only
  main/small); embedding-heavy deployments get no visual breakdown.
- One more sync DB query per `/stats/global` call (marginal cost on the
  existing cached path).

### Risks

- If `model_role` is mispopulated by a future LLM orchestrator change,
  counts silently shift. Mitigation: `model_role` is an enum constrained
  at the DB level; invalid values are rejected on insert.
- The KPI grid is now 5 columns; very narrow viewports may need responsive
  layout adjustments (out of scope for this decision).

## Implementation Notes

| File                                           | Role                                                          |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `src/stats/types.ts`                           | `LlmUsageGlobal` interface + field on `GlobalStats`           |
| `src/stats/global-llm.ts`                      | Sync Drizzle aggregator: GROUP BY `model_role`, window cutoff |
| `src/stats/index.ts`                           | Wires `llmUsageGlobal(window)` into `computeGlobalStats`      |
| `client/admin/global-stats.svelte.ts`          | Zod `.optional()` schema for `llmUsage`                       |
| `client/admin/sections/OverviewSection.svelte` | Fifth KPI card with `N main · N small` sub-label              |

Tests: `tests/stats/global-llm.test.ts` (4 cases: empty, aggregation,
window cutoff, null tokens), `tests/client/admin/sections/OverviewSection.test.ts`
(2 cases: rendered values, em-dash degradation).

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin runtime events are not
  part of this LLM aggregate; they remain in `plugin_runtime_events`.
- `/stats/*` anonymity contract (AGENTS.md) — constrains all fields
  returned by this aggregator to counts and numeric sums only.
- ADR-0009: Multi-Provider Task Tracker Support — the `model_role` enum
  parallels provider capability enums for structured aggregation.
