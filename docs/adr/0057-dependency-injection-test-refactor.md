<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0057: Incremental Dependency Injection for Test Isolation

## Status

Accepted

## Date

2026-04-05

## Context

Bun's `mock.module()` is process-global and permanent — `mock.restore()` resets spies
but not module mocks. ADR-0048 introduced `tests/mock-reset.ts` as a preload safety net,
and ADR-0054 added a guardrail-first strategy to contain the risk. Both treat the
symptom; DI removes the cause.

The codebase had 61 `mock.module()` invocations across 14 unique modules and 41 test
files. The global reset preload works but carries ongoing maintenance cost: every new
mocked module must be registered, and test authors must follow lifecycle rules specific
to Bun's mock behavior.

## Decision Drivers

- **Must eliminate test pollution at the root cause** — not just contain it
- **Must preserve current production call sites** — no behavioral change in non-test code
- **Must be incrementally adoptable** — one module per PR, never a big-bang refactor
- **Should make tests self-contained** — no reliance on preload infrastructure for
  migrated modules
- **Should align with existing patterns** — `_set*`/`_reset*` setters already in use
  for `src/db/drizzle.ts`

## Considered Options

### Option 1: Full dependency injection via `deps` parameter (Selected)

Add a `deps` parameter with sensible defaults to every function whose dependencies are
mocked in tests. Tests pass fakes directly; no `mock.module()` needed.

- **Pros:** Removes root cause; tests are inherently isolated; no preload maintenance
- **Cons:** Changes function signatures (though defaults preserve behavior); medium
  refactoring effort across many files

### Option 2: Wrapper modules with `_set*`/`_reset*` setters

Wrap external packages in thin modules that expose test-only setter functions.

- **Pros:** No function signature changes; familiar pattern
- **Cons:** Adds indirection layer; wrappers must track upstream API; only defers the
  problem (still process-global state)

### Option 3: Keep global mock reset as permanent solution

Rely on ADR-0048's preload forever; add an AST checker (ADR-0054) for enforcement.

- **Pros:** No production code changes
- **Cons:** Doesn't eliminate the pollution risk; ongoing maintenance; Bun-specific
  workaround rather than portable pattern

### Option 4: Test isolation via separate processes

Run each test file in its own Bun process.

- **Pros:** Complete isolation
- **Cons:** 10x+ slower; complex orchestration; doesn't address the architectural
  coupling

## Decision

We will adopt **incremental dependency injection** using three strategies based on
module type:

1. **Existing test-only setters** (`_setDrizzleDb`/`_resetDrizzleDb`) for singletons
   like `src/db/drizzle.ts`
2. **`deps` parameter with defaults** for functions calling external services (`ai`,
   `@ai-sdk/openai-compatible`, provider factories, etc.)
3. **Skip DI** for pervasive low-risk modules (`src/logger.ts` — 79 importers, only
   4 test mockers)

Each phase removes one module from `tests/mock-reset.ts` and is independently
shippable.

### Migration rules

- One module per PR
- After each phase, remove the migrated module from `tests/mock-reset.ts`
- Each PR must pass `bun test --randomize`
- Production callers unchanged (default parameters)

## Rationale

The `deps`-parameter pattern is already established in the codebase: 32 exported
`Deps` interfaces exist across `src/`. The orchestrator (`LlmOrchestratorDeps`),
scheduler (`SchedulerDeps`), memory (`MemoryDeps`), embeddings (`EmbeddingsDeps`),
conversation (`ConversationDeps`), and all recurring-task tool factories use it.
This is not a new pattern — it is codifying and extending an existing one.

The three-tier strategy (setters / deps / skip) avoids over-engineering by only
injecting dependencies that tests actually mock. The logger is a pragmatic exception:
79 importers, 4 mockers, low risk — the cost-benefit ratio favors keeping the
mock-reset entry.

## Consequences

### Positive

- Tests for migrated modules are self-contained — no dependency on preload order
- `tests/mock-reset.ts` shrinks over time toward logger-only
- Production code behavior unchanged (default parameters resolve to real imports)
- Pattern is portable across test runners — not Bun-specific

### Negative

- Function signatures grow a `deps` parameter (mitigated by defaults)
- DI-aware tests are slightly more verbose than `mock.module()` calls
- The migration is incremental — the codebase will have a mix of DI-first and
  legacy mock.module tests during transition

### Risks

- **Risk:** Over-injection — adding `deps` to modules that don't need it
  - **Mitigation:** Only inject dependencies that are actually mocked in tests

- **Risk:** `deps` interfaces drift out of sync with real implementations
  - **Mitigation:** Default objects reference the real imports directly

- **Risk:** Transition period has both patterns, confusing contributors
  - **Mitigation:** `tests/CLAUDE.md` documents both patterns with clear guidance

## Implementation Status

**Implemented**

### Phase 1: `src/db/drizzle.ts` — Setter-based DI

- `setupTestDb()` in `tests/utils/test-helpers.ts` calls `_setDrizzleDb(testDb)`
  directly (line 163)
- `mockDrizzle()` helper eliminated from test call sites
- `_resetDrizzleDb()` called in `tests/mock-reset.ts` global `beforeEach` (line 35)

### Phase 3: `deps` parameter for AI SDK modules

- `LlmOrchestratorDeps` in `src/llm-orchestrator-types.ts` — interface with
  `generateText`, `stepCountIs`, `buildOpenAI`, `buildProviderForUser`,
  `maybeProvisionKaneo`
- `BotDeps` in `src/bot.ts` — orchestrator construction uses deps
- `ConversationDeps` in `src/conversation.ts` — `buildModel` abstracted
- `MemoryDeps` in `src/memory.ts` — `generateText` abstracted
- `EmbeddingsDeps` in `src/embeddings.ts` — `embed` and `createProvider` abstracted
- `ProactiveLlmDeps` in `src/deferred-prompts/proactive-llm.ts`
- `SchedulerDeps` in `src/scheduler.ts` — provider construction abstracted

### Phase 5: Remaining modules

- `AnnouncementsDeps`, `AdminCommandsDeps`, `ContextCommandDeps`,
  `ContextCollectorDeps`, `RegistryDeps` — all follow the deps pattern
- All recurring-task tool factories have dedicated `Deps` interfaces
- Identity modules (`IdentityMappingDeps`, `ResolverDeps`) use deps
- Web-fetch chain (`SafeFetchDeps`, `PdfDeps`, `FetchAndExtractDeps`,
  `ExtractHtmlDeps`, `DistillDeps`, `WebFetchToolDeps`) uses deps

### Remaining `mock.module()` calls

45 `mock.module()` calls remain across 9 test files, primarily:

- `ai` and `@ai-sdk/openai-compatible` (15 calls in 5 test files) — deps interfaces
  exist but tests not fully migrated to pass fakes
- `src/providers/factory.js` (5 calls in `llm-orchestrator.test.ts`)
- `src/providers/kaneo/provision.js` (1 call in `llm-orchestrator.test.ts`)
- `src/chat/interaction-router.js` (2 calls in `bot.test.ts`)
- `src/logger.js` (9 calls in 3 test files) — intentionally kept (skip tier)
- `src/auth.js` (2 calls in chat adapter tests)

### `tests/mock-reset.ts` current state

6 entries remain in the originals array:
`logger`, `message-cache/cache`, `providers/kaneo/provision`, `chat/interaction-router`,
`ai`, `@ai-sdk/openai-compatible`

## Related Decisions

- [ADR-0048](0048-global-mock-reset-preload.md) — established the preload safety net
  that DI gradually replaces
- [ADR-0054](0054-mock-isolation-guardrails.md) — guardrail-first strategy that
  complements this incremental DI migration
- [ADR-0044](0044-rename-mock-pollution-to-test-health.md) — adjacent test-health work

## References

- Archived spec: `docs/archive/dependency-injection-test-refactor-spec-2026-04-05.md`
- Archived plan: `docs/archive/dependency-injection-test-refactor-impl-2026-04-05.md`
