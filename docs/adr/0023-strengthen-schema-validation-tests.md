<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0023: Strengthen Schema & Validation Test Suites (Phase 3)

## Status

Accepted

## Date

2026-03-22

## Context

YouTrack schema test coverage was minimal: 12 tests total across 7 files (1–3 tests each), with zero coverage for `CustomFieldValueSchema` and `IssueListSchema`. Kaneo client tests asserted that headers were defined (`toBeDefined()`) but never verified actual header values such as `Authorization: Bearer <key>` or `Cookie`. Approximately 70 instances of `expect(promise).rejects.toThrow()` across 17 test files were missing `await`, causing the assertions to return unawaited Promises — tests passed regardless of whether the promise actually rejected. Companion `await promise.catch(() => {})` lines suppressed unhandled rejection warnings without fixing the root cause.

## Decision Drivers

- Schema tests must reject malformed input deterministically and document the boundary between accepted and rejected data shapes.
- Every required field must have a "missing" rejection test; every type constraint (`.int()`, `.positive()`, `.string()`) must have a wrong-type test.
- Header assertions in Kaneo client tests must verify actual values, not just existence, to catch regressions in authentication logic.
- `expect().rejects` without `await` produces false confidence — the assertion never executes if the promise resolves instead of rejecting.
- No new libraries or structural changes; all fixes are test-layer only.

## Considered Options

### Option 1: Happy-path-only schema tests with manual review

Keep existing minimal tests (1–3 per schema file) and rely on manual code review to catch schema regressions.

- **Pros**: No additional test code to maintain.
- **Cons**: Schema changes (field additions, type changes, nullable-to-optional shifts) go undetected until production. Zero coverage for `CustomFieldValueSchema` (a 7-variant discriminated union used by every issue parse) and `IssueListSchema`. Missing `await` on `.rejects` means existing rejection tests provide false confidence.

### Option 2: Comprehensive boundary testing for every schema, header value verification, and await fixes (chosen)

Expand every YouTrack schema test file to 8–21 tests covering required-field rejection, wrong-type rejection, optional/nullable distinctions, nested sub-schema validation, and minimal-valid objects. Fix Kaneo client tests to assert exact header values. Add `await` to all `expect().rejects` calls and remove companion `.catch()` workarounds.

- **Pros**: Every schema boundary is explicitly tested. Header authentication logic is verified end-to-end. Rejection tests actually execute. Mechanical fixes reduce false-confidence risk to zero.
- **Cons**: Increases test count significantly (12 to 122 for YouTrack schemas alone). Adding `await` may reveal previously-hidden test failures requiring setup corrections.

## Decision

Three targeted improvements were implemented:

1. **YouTrack schema test expansion (Task 3.1)** — Expanded 7 existing schema test files and created 1 new file (`custom-fields.test.ts`), bringing total YouTrack schema tests from 12 to 122 across 8 files. Each schema file now covers required-field rejection, wrong-type rejection, optional vs nullable distinction, nested sub-schema validation, extra-field stripping, and minimal valid objects. `IssueListSchema` received 7 dedicated tests (previously zero). `CustomFieldValueSchema` received 19 tests covering all 7 discriminated union variants including the `UnknownIssueCustomFieldSchema` fallback.

2. **Kaneo client header value assertions (Task 3.2)** — Replaced `toBeDefined()` header assertions with exact value checks: `Authorization: Bearer <key>`, `Cookie: <cookie>`, `Content-Type: application/json`. Added mutual exclusivity test (when session cookie is set, `Authorization` header is absent). Added dedicated tests for PUT and PATCH HTTP methods. Kaneo client test count increased from 10 to 15.

3. **`await` on `expect().rejects` (Task 3.3)** — Added `await` before every `expect(promise).rejects` call and removed all companion `await promise.catch(() => {})` workaround lines across all affected test files (unit, tool, provider, and E2E). Zero instances remain without `await`; zero companion catch workarounds remain.

## Rationale

Schema tests serve as the first line of defence against API response shape changes. With 1–3 tests per schema, only the happy path was verified — field removals, type changes, or nullable shifts in the YouTrack API would pass silently through Zod parsing without any test catching the regression. The discriminated union in `CustomFieldValueSchema` (7 variants) had zero coverage, yet every `IssueSchema` parse depends on it. Expanding to boundary-level coverage for each schema makes the test suite a reliable contract for the expected API shapes.

Header value assertions in the Kaneo client are necessary because `toBeDefined()` passes even if the header contains the wrong value (e.g., a malformed Bearer token or a missing cookie). The authentication path is a critical integration point that must verify exact values.

The `await` fix is critical because without it, `expect(promise).rejects.toThrow()` returns a Promise that the test runner never awaits — the test completes before the assertion executes. If the underlying code stops throwing, the test still passes. This was the single largest source of false confidence in the test suite.

## Consequences

### Positive

- YouTrack schema tests increased from 12 to 122 across 8 files, covering all required-field rejections, type constraints, optional/nullable distinctions, and nested sub-schemas.
- `CustomFieldValueSchema` (7-variant discriminated union) has 19 dedicated tests; previously zero.
- `IssueListSchema` has 7 dedicated tests; previously zero.
- Kaneo client tests verify exact header values (`Authorization`, `Cookie`, `Content-Type`) and mutual exclusivity, not just existence.
- Zero `expect().rejects` without `await` remain in the codebase; all rejection assertions now execute synchronously within the test runner.
- Zero `await promise.catch(() => {})` workaround lines remain.

### Negative

- Test count increased substantially (122 schema tests alone), adding maintenance overhead when YouTrack schemas change.
- Adding `await` to `.rejects` may surface previously-hidden failures in future schema or provider changes, requiring prompt investigation rather than silent passing.

## Implementation Status

**Status**: Implemented

Evidence:

### Task 3.1 — YouTrack Schema Tests (122 tests across 8 files)

| Test File               | Test Count |
| ----------------------- | :--------: |
| `common.test.ts`        |     15     |
| `user.test.ts`          |     16     |
| `comment.test.ts`       |     14     |
| `tag.test.ts`           |     13     |
| `project.test.ts`       |     13     |
| `issue-link.test.ts`    |     11     |
| `issue.test.ts`         |     21     |
| `custom-fields.test.ts` |     19     |
| **Total**               |  **122**   |

All files located under `tests/providers/youtrack/schemas/`.

### Task 3.2 — Kaneo Client Header Assertions

- `tests/providers/kaneo/client.test.ts` — 15 tests. Header value assertions use `toBe('Bearer test-key')`, `toBe('better-auth.session_token=abc123')`, `toBe('application/json')`, and `toBeUndefined()` for mutual exclusivity. PUT and PATCH methods have dedicated tests.

### Task 3.3 — `await` on `expect().rejects`

- Zero instances of `expect(…).rejects` without `await` across all 29 test files containing `.rejects` assertions.
- Zero `await promise.catch(() => {})` workaround lines remaining.

## Related Decisions

- [ADR-0001: YouTrack Zod Schema Library](0001-youtrack-zod-schema-library.md) — established the YouTrack schema files that this ADR tests comprehensively.
- [ADR-0002: YouTrack Runtime Validation and types.ts Removal](0002-youtrack-runtime-validation-and-types-removal.md) — wired schemas into the production request/response path, making schema test coverage critical.
- [ADR-0020: Error Classification Improvements](0020-error-classification-improvements.md) — Phase 1 improvements that share the same test improvement roadmap.

## Related Plans

- `/docs/plans/done/2026-03-22-phase3-schema-validation-test-plan.md`
