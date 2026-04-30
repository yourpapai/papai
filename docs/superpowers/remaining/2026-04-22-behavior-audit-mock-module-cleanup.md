# Remaining Work: 2026 04 22 behavior audit mock module cleanup

**Status:** partially_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-22-behavior-audit-mock-module-cleanup.md`

## Completed

- Implementation of `ClassifyAgentDeps` in `scripts/behavior-audit/classify-agent.ts`
- Implementation of `Phase2aDeps` in `scripts/behavior-audit/classify.ts`
- Migration of primary tests in `tests/scripts/behavior-audit/classify-agent.test.ts` to use DI
- Migration of `tests/scripts/behavior-audit/phase2a.test.ts` to use DI (Task 2)

## Remaining

- Task 1: Refactor the config-reload test in `tests/scripts/behavior-audit/classify-agent.test.ts` to eliminate `mock.module` for `ai` and `@ai-sdk/openai-compatible`
- Task 3: Reduce module mocks in `tests/scripts/behavior-audit/incremental-integration.test.ts` (targets: `config.js`, `extract.js`, `classify.js`, `consolidate.js`, `evaluate.js`, `report-writer.js`)
- Task 4: Execute final linting, typechecking, and full repository verification (`bun check:verbose`)

## Suggested Next Steps

1. Refactor the remaining module mocks in `tests/scripts/behavior-audit/classify-agent.test.ts` to complete Task 1
2. Systematically migrate tests in `tests/scripts/behavior-audit/incremental-integration.test.ts` to DI as per Task 3
3. Run `bun check:verbose` to verify the final state of the codebase
