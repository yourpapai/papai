# Remaining Work: 2026 03 22 preprocessing classifier implementation

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-03-22-preprocessing-classifier-implementation.md`

## Completed

_None identified._

## Remaining

- Task 1: Classification module (`src/classifier.ts`, `tests/classifier.test.ts`)
- Task 2: Integration into `processMessage` flow (`src/llm-orchestrator.ts`, `tests/llm-orchestrator-classifier.test.ts`)
- Task 3: Graceful fallback and latency guardrails (`src/classifier.ts`, `src/llm-orchestrator.ts`)
- Task 4: Confirmation reply injection (`tests/llm-orchestrator-classifier.test.ts`)
- Task 5: Instruction revocation via classifier (`tests/llm-orchestrator-classifier.test.ts`)
- Task 6: Classification accuracy edge-case tests (`tests/classifier.test.ts`)
- Task 7: System prompt update for instruction-aware replies (`src/llm-orchestrator.ts`)
- Task 8: Integration test with full flow (`tests/classifier-integration.test.ts`)

## Suggested Next Steps

1. Implement Task 1: Create `tests/classifier.test.ts` and `src/classifier.ts`
2. Implement Task 2: Integrate classifier into `src/llm-orchestrator.ts` and create `tests/llm-orchestrator-classifier.test.ts`
3. Implement Task 3: Add timeout/fallback logic to `src/classifier.ts`
