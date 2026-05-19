# Remaining Work: 2026 04 24 behavior audit json extraction cleanup

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-24-behavior-audit-json-extraction-cleanup.md`

## Completed

_None identified._

## Remaining

- Task 1: Revert test import path in tests/scripts/behavior-audit/classify-agent.test.ts (shim already deleted)
- Task 2: Restore candidateKeywords min 8 in scripts/behavior-audit/extract-agent.ts
- Task 3: Restore MAX_STEPS and stepCountIs in scripts/behavior-audit/consolidate-agent.ts
- Task 4: Restore MAX_STEPS and stepCountIs in scripts/behavior-audit/evaluate-agent.ts
- Task 5: Run full behavior-audit test slice and repo-wide verification (typecheck, lint, format)

## Suggested Next Steps

1. Fix the ClassifyAgentDeps import in tests/scripts/behavior-audit/classify-agent.test.ts to point to the canonical module
2. Update scripts/behavior-audit/extract-agent.ts to restore Zod schema and prompt constraints
3. Restore step-limit guards (MAX_STEPS and stepCountIs) in consolidate-agent.ts and evaluate-agent.ts
4. Execute the full behavior-audit test suite and perform repo-wide quality checks
