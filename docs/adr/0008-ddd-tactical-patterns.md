<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0008: DDD Tactical Patterns

## Status

Accepted

## Date

2026-03-13

## Context

The DDD refactoring plan identified three independent improvements to increase Domain-Driven Design compliance:

1. **`UserId` branded type**: Raw `number` was used everywhere a Telegram user identity was expected, creating primitive obsession. A branded type would enforce identity semantics at compile time and prevent accidental misuse of plain integers in user-identity positions.
2. **`LlmOrchestrator` domain service**: Business orchestration logic was embedded inside `bot.ts`, which is a Telegram adapter (infrastructure layer). This made the orchestration pipeline impossible to test without a live bot connection and violated the principle that domain services should not depend on transport adapters.
3. **`FactExtractorRegistry`**: Fact extraction in `memory.ts` used an imperative if-chain that checked tool names. This required modifying existing code to add support for new tools, violating the open/closed principle.

## Decision Drivers

- Primitive obsession with raw `number` for user IDs creates a class of silent bugs that TypeScript could prevent at compile time.
- Orchestration logic coupled to Grammy's `Context` type prevents unit testing without a Telegram connection.
- An if-chain for fact extraction grows linearly with each new tool and is harder to reason about than a declarative map.

## Considered Options

### Option 1: `UserId` branded type (`type UserId = number & { readonly __brand: 'UserId' }`)

- **Pros**: Compile-time enforcement; no runtime cost; eliminates an entire class of misuse.
- **Cons**: Requires updating all six call sites; may conflict with multi-platform support where user IDs are strings.

### Option 2: Keep raw `number` for user IDs

- **Pros**: No migration cost.
- **Cons**: Primitive obsession persists; type safety gap.

### Option 3: Use `string` as a platform-agnostic user ID type

- **Pros**: Works for both Telegram (numeric) and Mattermost (string) without a branded type.
- **Cons**: Loses the compile-time branding benefit; requires string conversion for Telegram IDs.

### Option 4: Extract `LlmOrchestrator` from `bot.ts` (overlaps with ADR-0007)

- See ADR-0007 — this was implemented as part of the layered architecture enforcement.

### Option 5: Replace if-chain with `FACT_EXTRACTORS` registry map

- **Pros**: Open/closed compliance; new tools add an entry without touching existing logic.
- **Cons**: Minor refactor; marginal complexity reduction for current tool count.

## Decision

The three tasks were evaluated and implemented selectively:

- **`LlmOrchestrator` extraction**: Implemented as part of the layered architecture refactoring (ADR-0007). The orchestration logic now lives in `src/llm-orchestrator.ts`, decoupled from Grammy's `Context` type at the module boundary.
- **`UserId` branded type**: Not implemented as a Rust-style branded number. Instead, the codebase migrated to using `string` as the universal user ID type across all layers. This accommodates both Telegram (numeric IDs coerced to string) and Mattermost (string IDs) without requiring a separate branded type. The migration to a platform-agnostic string ID achieves a comparable goal — avoiding numeric primitive obsession — while enabling multi-platform support.
- **`FactExtractorRegistry`**: Not implemented as a declarative map. `extractFactsFromSdkResults` in `src/memory.ts` retains an imperative structure using `Array.includes` checks. The function was extended in scope (adding `delete_task`, `update_project`, `archive_project`, and `list_projects` extraction) but not restructured into a registry.

## Rationale

The `LlmOrchestrator` extraction was the highest-value change and was prioritized, delivered as part of the architectural layering work. The `UserId` branded number approach was superseded by the decision to support multiple chat platforms (Telegram and Mattermost), where a single branded `number` type would not work for Mattermost string IDs — migrating to `string` solved both problems simultaneously. The `FactExtractorRegistry` refactor was deferred as low priority; the current if-chain is functionally equivalent and the tool count does not yet justify the restructuring cost.

## Consequences

### Positive

- LLM orchestration is platform-agnostic and testable in isolation (via `tests/llm-orchestrator.test.ts`).
- User IDs are uniformly `string` across all layers, enabling multi-platform operation without type gymnastics.
- No primitive obsession with raw `number` for user identities in the persistence and domain layers.

### Negative

- No compile-time branding distinguishes a user ID string from an arbitrary string (unlike the proposed `UserId` branded type). Misuse is not caught by the TypeScript compiler.
- `extractFactsFromSdkResults` still uses an if-chain; adding a new tool that should produce facts requires modifying existing code rather than registering a new extractor.

## Implementation Status

**Status**: Partially Implemented

Evidence:

- `src/llm-orchestrator.ts` exists and exports `processMessage`, decoupled from Grammy's `Context` (it accepts `ReplyFn` instead). This fulfils the `LlmOrchestrator` goal.
- No `src/domain/ids.ts` exists. No `UserId` branded type is used anywhere in the codebase. All user ID parameters across `src/config.ts`, `src/users.ts`, `src/history.ts`, `src/memory.ts`, `src/conversation.ts` use `string`, not a branded type.
- `src/memory.ts` `extractFactsFromSdkResults` uses `Array.includes` checks, not a `FACT_EXTRACTORS` registry map. No `FactExtractor` type or `FACT_EXTRACTORS` constant exists.

## Related Plans

- `/docs/plans/done/2026-03-13-ddd-refactoring.md`
- ADR-0007 (layered architecture enforcement, which implements the `LlmOrchestrator` extraction)
