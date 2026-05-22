<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0094: Single Proxy Tool (`papai_tool`) — Deprecated in Favor of Intent-Routed Direct Tools

## Status

Deprecated (Reverted)

## Date

2026-05-12

## Context

### April 2026: The Proxy Tool Experiment

On 2026-04-30 papai adopted a single-proxy tool design (spec: `2026-04-30-single-proxy-tool-design.md`) to address the growing cost of tool-definition tokens as the provider surface expanded. The hypothesis was:

> Exposing one LLM-facing tool (`papai_tool`) instead of every individual tool reduces prompt-token overhead and simplifies tool discovery, while preserving internal execution code.

The proxy was implemented across several commits:

- `064fc0ba` — `src/tools/tool-proxy-modes.ts` (status, list, search, describe, call modes)
- `1c3627b7` — wiring via `makeToolProxy()` in `src/tools/index.ts`
- `b1ec276e`, `6878a373`, `889a3b51` — bug fixes for search refinement, arg parsing, and execution
- `dedd5b15`, `88c92c1b` — test updates

### Why It Did Not Stick

Twelve days later (`2fc5470b`, 2026-05-12), the proxy was **removed** and direct tool exposure was restored. The reasoning was not documented in a committed message or spec, but the reversal coincided with the introduction of **intent-based tool routing** (`18b0a7e5`, 2026-04-25), which offered an alternative way to reduce token overhead:

- **Proxy approach**: Always expose 1 tool with a verbose JSON schema (`tool`, `mode`, `query`, `args`); LLM pays parsing cost for every invocation; single-step latency is higher because every tool call passes through an extra layer.
- **Intent routing approach**: At request time, inspect the user's message text (`classifyToolRoutingIntent`) and expose only the _subset_ of tools likely needed; LLM sees the familiar direct-tool schema for the relevant tools and pays zero extra parsing cost.

The intent-routing approach proved superior in practice because:

1. **Reduced overall tool surface** (e.g., recurring/deferred/web/memo tools hidden when the user is clearly asking about tasks).
2. **Familiar tool schemas** (no `papai_tool` indirection with mode dispatch).
3. **Zero single-call overhead** (direct tool execution path preserved).
4. **Simpler LLM compatibility** (models already handle direct tool calls well; some models struggle with nested JSON in proxy args).

## Decision Drivers

1. **Token efficiency vs. latency**: Proxy saves static tokens on tool definitions but adds dynamic tokens per call; routing saves static tokens without dynamic overhead.
2. **Execution path simplicity**: The proxy added `<proxy> → <mode dispatch> → <arg parse> → <tool exec>` vs. direct `<tool exec>`.
3. **Observability/debuggability**: Direct tools appear in traces by name (`create_task`, `get_task`); proxy calls all look like `papai_tool` with nested details.
4. **LLM reliability**: Some models (esp. smaller ones on the `small_model` channel) had higher parsing error rates on the proxy schema.

## Considered Options

### Option 1: Single Proxy Tool (original implementation)

- **Pros**: Minimal static tool-definition tokens; consistent `papai_tool` schema across all capabilities.
- **Cons**: Higher round-trip latency; parsing overhead per call; worse observability; model compatibility issues.
- **Verdict**: **Rejected** after production trial — the trade-offs were not worth the token savings.

### Option 2: Intent-Routed Direct Tool Subsets (accepted)

- **Pros**: Familiar direct-tool API; selective exposure based on message intent; no extra execution layer.
- **Cons**: Keyword-based classification is imprecise (falls back to `full` when uncertain); requires maintenance of keyword regexes.
- **Verdict**: **Accepted** — better balance of token savings, latency, and detectability. Code located at `src/tools/tool-router.ts`, used in `src/llm-orchestrator-tools.ts` and `src/deferred-prompts/proactive-llm.ts`.

### Option 3: Keep Both (proxy + routing)

- **Pros**: Could offer a `proxy: false` toggle for compatibility.
- **Cons**: Maintains two paths with divergent test expectations and bug surface; the proxy path was already a maintenance burden.
- **Verdict**: **Rejected** — the proxy toggle (`isProxyDisabled`) was removed in the same commit (`2fc5470b`).

## Decision

**Deprecate the `papai_tool` single-proxy architecture. Remove `src/tools/tool-proxy.ts`, `src/tools/tool-proxy-modes.ts`, and all related benchmark/test infra. Restore direct tool exposure from `buildTools()` through `wrapToolSet()` in `src/tools/index.ts`. Use `routeToolsForMessage()` as the primary strategy for reducing tool surface tokens.**

## Rationale

- Intent routing achieves the same goal (tool surface reduction) with better execution characteristics.
- The proxy was a clean experiment, but the data/UX showed no advantage and some regressions.
- Removing it reduces code surface, test complexity, and cognitive load.

## Consequences

### Positive

- Simpler `src/tools/index.ts` (one path, not two).
- Faster tool execution (no proxy dispatch layer).
- Better tooling and trace observability (tool names are meaningful again).
- Reduced maintenance burden (no dual-mode test expectations).

### Negative

- Lost the proxy-based `describe`/`search` UX that some internal debugging flows relied on (replaced by `tool-metadata.ts` + `tool-router.ts`).
- Removed `scripts/tool-proxy-benchmark.ts` and `tests/scripts/tool-proxy-benchmark.test.ts` (replaced by `scripts/tool-surface-benchmark.ts`, see ADR-0093).

### Risks

- Keyword-based routing can still misclassify edge-case messages (mitigated by high-confidence threshold `HIGH_CONFIDENCE = 0.65` and fallback to full tool set).

## Implementation Notes

| Commit                             | Action                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `1c3627b7`                         | Introduce `papai_tool` proxy via `makeToolProxy()`                  |
| `b84bcc4b`–`6878a373`              | Fix search, args, execution bugs                                    |
| `0ab46fd7`, `d7d510e6`, `d33e7430` | Proxy benchmark runner                                              |
| `2fc5470b`                         | **Remove proxy** and `isProxyDisabled` toggle; restore direct tools |
| `d70f30a5`                         | Update YouTrack integration test for direct tools                   |
| `88c92c1b`                         | (Already reverted by `d70f30a5`) Update for proxy                   |
| `fbd41439`                         | Format cleanup pass — get `bun check:full` green                    |

Files deleted in `2fc5470b`:

- `docs/superpowers/specs/2026-04-30-single-proxy-tool-design.md`
- `docs/superpowers/plans/2026-04-30-single-proxy-tool-implementation.md`
- `src/tools/tool-proxy.ts`
- `src/tools/tool-proxy-modes.ts`
- `tests/tools/tool-proxy.test.ts`
- `tests/tools/tool-proxy-modes.test.ts`

Files retained from proxy era:

- `src/tools/tool-metadata.ts` — extracted metadata system reused by router
- `scripts/tool-surface-benchmark.ts` — generalized from proxy benchmark to surface comparison (ADR-0093)

## Related Decisions

- **ADR-0093**: Tool Surface Benchmark — uses intent routing as the comparison baseline.
- **ADR-0092**: Architecture Inventory — deletion candidate `tool-proxy-*` categories referenced the now-removed files.

## References

- Original design spec (archived in git history): `docs/superpowers/specs/2026-04-30-single-proxy-tool-design.md`
- Original plan (archived in git history): `docs/superpowers/plans/2026-04-30-single-proxy-tool-implementation.md`
- Remediation plan (now stale): `docs/superpowers/plans/2026-05-09-bun-check-full-remediation.md`
- Current routing code: `src/tools/tool-router.ts`
- Current orchestrator wiring: `src/llm-orchestrator-tools.ts`
