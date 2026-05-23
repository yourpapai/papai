<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2026 04 22 behavior audit mock module cleanup

**Status:** complete (pending archive)
**Generated:** 2026-04-29
**Last verified:** 2026-05-23
**Plan (archived):** `docs/archive/behavior-audit-mock-module-cleanup-2026-04-22.md`
**ADR:** `docs/adr/0111-behavior-audit-mock-module-cleanup.md`

## Completed

- Implementation of `ClassifyAgentDeps` in `scripts/behavior-audit/classify-agent.ts`
- Implementation of `Phase2aDeps` in `scripts/behavior-audit/classify.ts`
- Migration of primary retry/sleep tests in `tests/scripts/behavior-audit/classify-agent.test.ts` to DI
- Migration of `tests/scripts/behavior-audit/phase2a.test.ts` to DI (Task 2) — file has zero `mock.module` calls
- Task 1 (2026-05-23): Exported `createDefaultClassifyAgentDeps()` from `scripts/behavior-audit/classify-agent.ts` as a test seam and rewrote the reloaded-config test to assert the default deps' `config.BASE_URL` snapshot after `reloadBehaviorAuditConfig()`. Removed `mock.module` for `ai` and `@ai-sdk/openai-compatible` from `classify-agent.test.ts`; updated the `isClassifyAgentModule` shape guard to require the new export.
- Task 3 leftover startup mocks in `tests/scripts/behavior-audit/incremental-integration.test.ts` are annotated inline at the `beforeEach` block (`// This suite intentionally keeps narrow module mocks because it is verifying entrypoint startup behavior that happens during delayed module import.`), matching the plan's Task 3 Step 3 exit criterion for justified delayed-import startup coverage.
- Task 4 (2026-05-23): `bun check:verbose` — exit 0 (3225 tests pass, lint/typecheck/format/knip/duplicates/review-loop suites all green).

## Out-of-Scope Mock.module Inventory (not covered by this plan)

- `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts` still mocks `ai` and `@ai-sdk/openai-compatible`. Same pattern as the original classify-agent leftover; tracked separately if/when the consolidate-keywords agent is migrated to DI.

## Next Steps

- Move this brief to `docs/archive/` (rename `2026-04-22-behavior-audit-mock-module-cleanup.md` → archive path). Optionally open a follow-up brief for the `consolidate-keywords-agent.test.ts` migration.
