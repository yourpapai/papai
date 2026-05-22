<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0106: DRY Duplicate Test Code — Divergence Notes

> Companion document to ADR-0106. Captures deviations between the implementation plan and the actual implementation. Each deviation includes why it happened and whether correction is needed.

---

## Deviation 1: Kaneo search response fixture (`createMockKaneoTaskSearchResponse`) is unused

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan task**      | Task 5 — Extract shared Kaneo search response fixture                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Plan reference** | Factory: `createMockKaneoTaskSearchResponse` in `tests/utils/factories.ts`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Expected**       | Both `tests/providers/kaneo/search-tasks.test.ts` and `tests/providers/kaneo/operations/tasks.test.ts` import and call `createMockKaneoTaskSearchResponse()` to produce mock fetch responses.                                                                                                                                                                                                                                                                                                    |
| **Actual**         | `createMockKaneoTaskSearchResponse` exists in `tests/utils/factories.ts` but is **not imported or used** in either Kaneo test file. The 41-line inline `tasks: [...]` response block remains duplicated between the two files (271 tokens, detected by `jscpd`).                                                                                                                                                                                                                                 |
| **Why**            | The factory was committed in `ac2a96eb` on 2026-04-27 using the then-current response shape (`results: [...]`, `totalCount: 2`, `searchQuery: 'test'`). Four subsequent Kaneo API alignment commits (`bf0b02bb`, `2e65a3b0`, `a1435834`, `94e5e07c`) changed the search response contract to use `tasks: [...]`, `projects: []`, `workspaces: []`, `comments: []`, `activities: []`. The factory was never updated to match the new shape, and the consuming tests were modified inline instead. |
| **Impact**         | The factory is dead code. The clone pair the task was meant to eliminate still exists.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Correct?**       | **No** — either update the factory to the new `tasks: [...]` shape and make both test files use it, or delete the factory if Kaneo search responses are too variable to centralize.                                                                                                                                                                                                                                                                                                              |

---

## Deviation 2: `fake-agent-integration.test.ts` not migrated to `createReviewLoopConfigFixture`

| Field              | Value                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 4 — Extract review-loop config fixture and temp-dir helpers                                                                                                                                                                                                                                                                                               |
| **Plan reference** | Update `cli.test.ts`, `loop-controller.test.ts`, `run-state.test.ts`                                                                                                                                                                                                                                                                                           |
| **Expected**       | All review-loop tests that define inline `ReviewLoopConfig` JSON use `createReviewLoopConfigFixture`.                                                                                                                                                                                                                                                          |
| **Actual**         | `tests/review-loop/fake-agent-integration.test.ts` still defines a 29-line inline config JSON object. `jscpd` reports a 221-token clone between this block and `cli.test.ts` lines 173–202. The file does **not** import `createReviewLoopConfigFixture` from `../test-helpers.js`.                                                                            |
| **Why**            | The file was **not listed** in the plan's Files section. The plan explicitly listed only `cli.test.ts`, `loop-controller.test.ts`, and `run-state.test.ts`. The clone between `cli.test.ts` and `fake-agent-integration.test.ts` was known to `jscpd` but overlooked during plan authorship.                                                                   |
| **Impact**         | One clone pair remains unaddressed. The file also duplicates `makeTempDir` logic (inline `tmpdir()` + `mkdtempSync`) instead of importing the shared helper.                                                                                                                                                                                                   |
| **Correct?**       | **No** — update `fake-agent-integration.test.ts` to import `createReviewLoopConfigFixture` and `makeTempDir` from `tests/review-loop/test-helpers.js`. The config shape differs slightly (uses `bun` commands and `requireInvocationPrefix: true`), so the import should be: `createReviewLoopConfigFixture(repoRoot, { reviewer: { ... }, fixer: { ... } })`. |

---

## Deviation 3: Additional helpers added to `fetch-mock-utils.ts` post-implementation

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 3 — Extract YouTrack fetch mock utilities                                                                                                                                                                                                                                                                                                                                    |
| **Plan reference** | Helpers: `installFetchMock`, `mockFetchResponse`, `mockFetchSequence`, `mockFetchError`, `mockFetchNoContent`, `getLastFetchUrl`, `getLastFetchBody`, `getLastFetchMethod`, `getFetchUrlAt`, `getFetchBodyAt`, `getFetchMethodAt`, `FetchCallSchema`, `BodySchema`                                                                                                                |
| **Expected**       | Exactly the helpers listed in the plan.                                                                                                                                                                                                                                                                                                                                           |
| **Actual**         | Two additional helpers were added after the initial extraction: `createUniqueYouTrackConfig` and `createUniqueProjectId`. A `parseBody` internal helper was also extracted to avoid duplicating `JSON.parse` logic in `getLastFetchBody` and `getFetchBodyAt`.                                                                                                                    |
| **Why**            | `createUniqueYouTrackConfig` was introduced in `733c4262` to prevent cached-group-observation tests from colliding when run in parallel (shared `baseUrl` caused cross-test leakage through the `WeakMap` cache). `createUniqueProjectId` supports the same isolation pattern. `parseBody` was a minor refactoring to eliminate inline duplication within the helper file itself. |
| **Impact**         | Positive — the utilities file gained functionality not anticipated by the plan, but the additions are purely additive and do not break existing consumers.                                                                                                                                                                                                                        |
| **Correct?**       | **Yes** — acceptable post-implementation refinement. The helpers should remain.                                                                                                                                                                                                                                                                                                   |

---

## Deviation 4: `BodySchema` uses `z.unknown()` instead of `z.string()` for body parsing

| Field              | Value                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 3 — YouTrack fetch mock utilities                                                                                                                                                                                                            |
| **Plan reference** | `FetchCallSchema` definition: `z.tuple([z.string(), z.looseObject({ method: z.string().optional(), body: z.string().optional() })])`                                                                                                              |
| **Expected**       | `body: z.string().optional()` in the tuple schema.                                                                                                                                                                                                |
| **Actual**         | `body: z.unknown().optional()` in the tuple schema, with a `parseBody` helper that guards with `typeof body !== 'string'` before calling `JSON.parse`.                                                                                            |
| **Why**            | Some `fetch` calls pass `body` as `FormData` or `URLSearchParams` (not strings), especially in multipart upload tests. Strict `z.string()` would reject these calls at the schema level, making `getLastFetchBody` unusable for attachment tests. |
| **Impact**         | `getLastFetchBody` gracefully handles non-string bodies by returning `{}`. The schema is slightly more permissive than the plan specified.                                                                                                        |
| **Correct?**       | **Yes** — the deviation was necessary for test coverage of non-JSON fetch bodies.                                                                                                                                                                 |

---

## Deviation 5: Missing spec document

| Field                | Value                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan expectation** | ADR derived from `docs/superpowers/specs/` + `docs/superpowers/plans/`                                                                                 |
| **Actual**           | No spec document exists (`docs/superpowers/specs/` contains no `2026-04-25-dry-duplicate-test-code-design.md`). The plan was the sole design artifact. |
| **Why**              | This was a purely mechanical refactoring driven by `jscpd` output. No architectural decisions were contemplated — only extraction targets.             |
| **Impact**           | No functional impact. The ADR captures the rationale that a spec would normally provide.                                                               |
| **Correct?**         | **Acceptable** — for mechanical refactoring, a standalone plan is sufficient.                                                                          |

---

## Summary Table

| #   | Deviation                                     | Severity   | Needs Correction                   |
| --- | --------------------------------------------- | ---------- | ---------------------------------- |
| 1   | Kaneo factory unused (old response shape)     | **Medium** | Yes — update or delete factory     |
| 2   | `fake-agent-integration.test.ts` not migrated | **Medium** | Yes — import shared helpers        |
| 3   | Extra helpers added to `fetch-mock-utils.ts`  | None       | No — additive improvement          |
| 4   | `BodySchema` uses `z.unknown()`               | None       | No — necessary for multipart tests |
| 5   | No spec document                              | None       | No — mechanical refactoring        |
