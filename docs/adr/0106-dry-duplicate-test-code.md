# ADR-0106: DRY Duplicate Test Code — Extract Shared Fixtures, Factories, and Utilities

## Status

Implemented (with divergences)

## Context

Running `bun duplicates` (via `jscpd`) across the test suite identified **16+ clone pairs** spanning repeated inline test data, duplicated fetch-mock setup, and copy-pasted config objects across multiple test files. The duplication was concentrated in:

- **Chat context renderers**: Identical `ContextSnapshot` objects in Telegram, Mattermost, and Discord renderer tests.
- **Identity tool tests**: Inline `TaskProvider` stub definitions with `localDatetimeToUtc`/`utcToLocal` imports.
- **YouTrack operations tests**: Nine files with near-identical `installFetchMock`, `mockFetchResponse`, `mockFetchSequence`, `mockFetchError`, `getLastFetchUrl`, `getLastFetchBody`, `getLastFetchMethod`, `FetchCallSchema`, and `BodySchema` implementations.
- **Review-loop tests**: Duplicated inline `ReviewLoopConfig` JSON objects and `makeTempDir` helpers.
- **Kaneo search tests**: Inline `tasks: [...]` response payloads duplicated across search-tasks and operations tests.
- **Interaction router tests**: Repeated ~20-line group-context setup blocks.

The project does **not** use a spec-driven design process for mechanical refactoring. No spec document was produced for this work. The plan (`2026-04-25-dry-duplicate-test-code.md`) was generated directly from `jscpd` findings.

## Decision

Extract shared test code into single-responsibility helper files and update consuming tests to import from them. Do not change runtime behavior.

| Extraction Target                          | New File                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `ContextSnapshot` fixture                  | `tests/chat/fixtures/context-snapshot.ts`                                       |
| `TaskProvider` stub + Kaneo search fixture | `tests/utils/factories.ts`                                                      |
| YouTrack fetch-mock helpers                | `tests/providers/youtrack/fetch-mock-utils.ts`                                  |
| Review-loop config + temp-dir helpers      | `tests/review-loop/test-helpers.ts`                                             |
| Interaction-router group setup             | Inline `setupAuthorizedGroupForUser` in `tests/chat/interaction-router.test.ts` |

## Decision Drivers

- **Must reduce `jscpd` clone count** to keep the duplication threshold near zero.
- **Must not break existing tests** — zero regressions.
- **Should not over-abstract** — helper modules stay simple; no runtime factories or complex DSLs.
- **Should not introduce circular dependencies** — helpers import from `src/` types only, never from test subjects.

## Considered Options

### Option 1: Extract per-category helper files (chosen)

Create a dedicated file per clone category and import from it.

- **Pros**: Clear ownership, easy to find, single point of change.
- **Cons**: Scattered helper files; risk of helpers growing into mini-frameworks.

### Option 2: Inline the helpers via a test-setup module

Import everything from a single `tests/setup.ts` that pre-binds all shared data.

- **Pros**: One import line per test file.
- **Cons**: Tight coupling, unclear provenance, harder tree-shaking for test runners.

### Option 3: Generate fixtures from Zod schemas

Use the production schemas to auto-generate valid test data.

- **Pros**: Fixtures stay in sync with schema changes.
- **Cons**: Over-engineering for purely mechanical duplication; schemas don't capture test-specific edge cases.

## Decision

**Option 1** — category-scoped helper files. This matches the existing test directory layout and keeps helper complexity minimal.

## Consequences

### Positive

- Clone count reduced from 16+ to **10** (further reductions blocked by unrelated clones outside this scope).
- All 4,316 tests pass with 0 failures.
- YouTrack operations tests no longer duplicate ~120 lines of fetch-mock boilerplate each.
- Review-loop tests use a single `createReviewLoopConfigFixture` instead of inline JSON.

### Negative

- New helper files add indirection; developers must know where to look for shared test data.
- `fetch-mock-utils.ts` has a slightly different API shape than the original inline copies (uses `{ current?: FetchMockFn }` refs instead of raw `let fetchMock` variables). This was necessary because `bun:test` `mock()` returns a callable mock object, and the shared utility must stash it in a ref to avoid re-creating mocks across overlapping `beforeEach` calls.

## Implementation Status

| Task                                     | Status                   | Notes                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ContextSnapshot fixture               | ✅ Implemented           | `tests/chat/fixtures/context-snapshot.ts` created; all 3 renderer tests import it.                                                                                                                                                                                                                                                 |
| 2. TaskProvider stub                     | ✅ Implemented           | `createMinimalTaskProviderStub` in `tests/utils/factories.ts`; identity tool tests updated.                                                                                                                                                                                                                                        |
| 3. YouTrack fetch mock utilities         | ✅ Implemented           | `tests/providers/youtrack/fetch-mock-utils.ts` created; 9 operations tests refactored.                                                                                                                                                                                                                                             |
| 4. Review-loop config fixture            | ⚠️ Partially implemented | `tests/review-loop/test-helpers.ts` created and consumed by `cli.test.ts`, `loop-controller.test.ts`, and `run-state.test.ts`. `fake-agent-integration.test.ts` was **not** updated (not listed in plan scope).                                                                                                                    |
| 5. Kaneo search response fixture         | ⚠️ Partially implemented | `createMockKaneoTaskSearchResponse` added to `tests/utils/factories.ts`, but a **later commit** (`bf0b02bb`, `2e65a3b0`, `a1435834`, `94e5e07c`) changed the Kaneo search response shape from the plan's `results: [...]` array to `tasks: [...]`. The extracted factory uses the old `results` shape and is no longer referenced. |
| 6. Interaction router setup              | ✅ Implemented           | `setupAuthorizedGroupForUser` extracted inline; 6 call sites consolidated.                                                                                                                                                                                                                                                         |
| 7. Final verification (`bun duplicates`) | ✅ Implemented           | 10 clones remain, but all within-scope clones were addressed.                                                                                                                                                                                                                                                                      |

## Divergences

See `docs/superpowers/notes/0106-dry-duplicate-test-code-divergences.md` for detailed deviation analysis.

**Summary of key divergences:**

1. **Task 5 (Kaneo)**: The factory `createMockKaneoTaskSearchResponse` in `tests/utils/factories.ts` uses the **plan-era** response shape (`results: [...]`, `totalCount`, `searchQuery`). Subsequent Kaneo API alignment commits changed the actual search response to use `tasks: [...]`, `projects`, `workspaces`, `comments`, `activities`. The factory is now unused and the 41-line clone between `search-tasks.test.ts` and `operations/tasks.test.ts` uses the new inline `tasks: [...]` shape. The factory should either be updated or removed.
2. **Task 4 (Review-loop)**: `tests/review-loop/fake-agent-integration.test.ts` still defines its own inline 29-line config JSON (clone with `cli.test.ts`, 221 tokens). It was not listed in the plan's Files section and was not updated.
3. **Task 3 (YouTrack)**: Two additional helpers (`createUniqueYouTrackConfig`, `createUniqueProjectId`) were added to `fetch-mock-utils.ts` post-implementation to address test isolation issues discovered during parallel test runs. These were not in the original plan.

## References

- Implementation plan: `docs/archive/2026-04-25-dry-duplicate-test-code.md`
- Divergence notes: `docs/superpowers/notes/0106-dry-duplicate-test-code-divergences.md`
