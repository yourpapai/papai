# ADR-0111: Behavior Audit — Replace Avoidable mock.module() with Dependency Injection

## Status

Implemented

## Date

2026-04-22

## Context

ADR-0057 established an incremental dependency-injection (DI) strategy to replace `mock.module()` calls — Bun's process-global and permanent module mocking — with directly injected dependencies. That migration removed approximately 16 of 61 remaining `mock.module()` invocations across the codebase.

The behavior-audit test suite still had the next-largest concentration of avoidable module mocks after the main application code. Specifically:

- **4 `mock.module()` calls** in `tests/scripts/behavior-audit/classify-agent.test.ts` mocking `config.js`, `ai`, and `@ai-sdk/openai-compatible`.
- **Implicit mocking** in `tests/scripts/behavior-audit/phase2a.test.ts` via `mock.module()` on `classify-agent.js` (indirectly through `mockAuditBehaviorConfig`).
- **7 `mock.module()` calls** in `tests/scripts/behavior-audit/incremental-integration.test.ts` mocking entrypoint modules, `config.js`, `extract.js`, `classify.js`, `consolidate.js`, `evaluate.js`, and `report-writer.js`.

The `classify-agent.js` module in particular mixed module-level `createOpenAICompatible()` provider construction with `generateText()` calls and `config.js` imports, making it impossible to inject fakes without adding a DI seam.

## Decision Drivers

- **Must align with ADR-0057** — extend the existing `deps` pattern rather than introduce Bun-specific reset rules.
- **Must remove avoidable `mock.module()` usage** — only the startup/import-order test case justifies module-level mocking.
- **Must keep production callers unchanged** — default parameters resolve to real imports.
- **Must preserve all test behavior** — 219+ behavior-audit tests must continue passing.
- **Must not add test-only setters** — ADR-0057 selected `deps` parameters for AI-facing modules.

## Considered Options

### Option 1: Add `ClassifyAgentDeps` and `Phase2aDeps` seams (Selected)

Add `deps` parameters with real defaults to `classifyBehaviorWithRetry()` and `runPhase2a()`. Tests pass fake implementations directly.

- **Pros:** Follows ADR-0057; tests self-contained; no preload maintenance; production unchanged.
- **Cons:** Adds one parameter to public function signatures (mitigated by defaults).

### Option 2: Expand `tests/mock-reset.ts` for behavior-audit modules

Add behavior-audit modules to the global mock-reset preload.

- **Pros:** No production code changes; minimal test changes.
- **Cons:** Treats symptom not cause; increases preload maintenance; violates ADR-0057 direction.

### Option 3: Test-only `_set*`/\_reset\*` setters on classify-agent

Expose mutable module-level state that tests can override.

- **Pros:** No function signature changes.
- **Cons:** Test-only setters leak into production API; still process-global state; ADR-0057 explicitly rejected this for AI-facing modules.

## Decision

Adopt **Option 1** (DI seams) for three modules:

1. **`scripts/behavior-audit/classify-agent.ts`** — extract `ClassifyAgentDeps` interface covering `config`, `generateText`, `buildModel`, `outputObject`, `stepCountIs`, `sleep`, and `createAbortSignal`. Provide `createDefaultClassifyAgentDeps()` with real imports.

2. **`scripts/behavior-audit/classify.ts`** — extract `Phase2aDeps` interface covering `classifyBehaviorWithRetry`, file I/O helpers, progress helpers, and `maxRetries`. Provide `createDefaultPhase2aDeps()` with real imports.

3. **Leave `incremental-integration.test.ts` unchanged** for its startup/import-order coverage — it intentionally validates entrypoint initialization wiring via delayed import and module evaluation order. Add an inline comment documenting this justification.

## Rationale

The `deps` pattern is already dominant in the codebase (32+ exported `Deps` interfaces). Adding two more in behavior-audit is consistent and low-risk. The `classify-agent.ts` seam is particularly important because it is the boundary between the behavior-audit pipeline and the AI SDK (`ai`, `@ai-sdk/openai-compatible`, `zod`, `Output.object`, `stepCountIs`) — exactly the kind of external-service boundary DI was designed for.

Retaining the `incremental-integration.test.ts` mocks is an intentional ADR-0057 exception: the test's purpose is to prove that `runBehaviorAudit()` writes `lastStartCommit` to the manifest during module evaluation, which requires exercising the delayed-import wiring. Converting this to DI would change what the test verifies.

## Consequences

### Positive

- `classify-agent.test.ts` retry tests no longer need `mock.module()` for `ai` or `@ai-sdk/openai-compatible`.
- `phase2a.test.ts` no longer needs `mock.module('../../scripts/behavior-audit/classify-agent.js')`.
- Tests are portable across test runners (not Bun-specific).
- `tests/mock-reset.ts` preload shrinks (behavior-audit modules no longer registered).

### Negative

- `classifyBehaviorWithRetry` gained an overloaded signature (two arities: with and without `deps`).
- `runPhase2a` gained an overloaded signature (two arities: with and without `Partial<Phase2aDeps>`).
- DI-aware tests are slightly more verbose than `mock.module()` calls.

### Risks

- **Risk:** `deps` interfaces drift from real implementation shapes.
  - **Mitigation:** Default factories reference real imports directly; type checker catches drift.

- **Risk:** Tests that still use `mock.module()` (startup/import-order) become harder to discover.
  - **Mitigation:** Inline comment in `incremental-integration.test.ts` documents the intentional leftover.

## Implementation Status

**Implemented**

### `scripts/behavior-audit/classify-agent.ts`

- `ClassifyAgentDeps` interface exported at line ~46 covering all external dependencies.
- `createDefaultClassifyAgentDeps()` returns real-import defaults.
- `classifyBehaviorWithRetry` overloaded: `(prompt, attemptOffset)` → defaults, `(prompt, attemptOffset, deps)` → injected.
- `classifySingle`, `getRetryBackoff`, `classifyAttempt`, `retryClassification` all accept `deps`.
- `verboseGenerateText` used as default `generateText` (passes through with logging).

### `scripts/behavior-audit/classify.ts`

- `Phase2aDeps` interface exported at line ~29 covering `classifyBehaviorWithRetry`, file I/O, progress helpers, `maxRetries`, `log`, `reporter`, `stats`.
- `createDefaultPhase2aDeps()` returns real-import defaults.
- `runPhase2a` overloaded: `(input)` → defaults, `(input, deps)` → injected.
- All internal helpers (`classifySelectedBehavior`, `writeSingleClassification`, `persistSuccessfulClassification`, `processSelectedClassification`) use resolved deps.

### `tests/scripts/behavior-audit/classify-agent.test.ts`

- Retry tests pass `ClassifyAgentDeps` directly with fake `generateText`, `sleep`, etc.
- One remaining test (`classifyBehaviorWithRetry default path reads reloaded config after module import`) uses `mock.module()` for `@ai-sdk/openai-compatible` and `ai` — this is startup/import-order coverage and is intentionally preserved.

### `tests/scripts/behavior-audit/phase2a.test.ts`

- No `mock.module()` calls in the current version.
- Tests pass `classifyBehaviorWithRetry` fake via `Partial<Phase2aDeps>` to `runPhase2a()`.
- Retry-budget and resumed-run tests work through the DI seam without module mocking.

### `tests/scripts/behavior-audit/incremental-integration.test.ts`

- 7 remaining `mock.module()` calls — all justified by the startup/import-order test contract.
- Inline comment at the `mock.module()` block explains why they are kept.

## Remaining `mock.module()` inventory in behavior-audit tests

```
2  tests/scripts/behavior-audit/classify-agent.test.ts          (startup/import-order only)
2  tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts  (out of scope)
7  tests/scripts/behavior-audit/incremental-integration.test.ts  (startup delayed import)
```

## Related Decisions

- [ADR-0057](0057-dependency-injection-test-refactor.md) — parent DI strategy that this extends
- [ADR-0048](0048-global-mock-reset-preload.md) — preload safety net that DI gradually replaces
- [ADR-0054](0054-mock-isolation-guardrails.md) — guardrail-first strategy complementing DI

## References

- Archived plan: `docs/archive/behavior-audit-mock-module-cleanup-2026-04-22.md`
- Implementation commit: `e058d638c99a02e369245020c5481ee1e8f166c7`
- `tests/CLAUDE.md` — mocking and DI patterns for test authors
