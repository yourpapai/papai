# Remaining Work: 2026 03 30 fix provider abstraction leaks

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-03-30-fix-provider-abstraction-leaks.md`

## Completed

_None identified._

## Remaining

- Task 1: Add Provisioning Capability to TaskProvider interface in src/providers/types.ts
- Task 2: Implement provisionUser method in KaneoProvider (src/providers/kaneo/index.ts)
- Task 3: Refactor error handling and remove provider-specific imports in src/llm-orchestrator.ts
- Task 4: Implement generic workspace functions in src/users.ts
- Task 5: Update src/providers/factory.ts to use generic workspace functions
- Task 6: Update src/scheduler.ts to use generic workspace functions
- Task 7: Update src/wizard/steps.ts to use dynamic provider metadata
- Task 8: Remove provider-specific imports from src/commands/admin.ts
- Task 9: Run final verification (lint, typecheck, tests)

## Suggested Next Steps

1. Implement Task 1 in src/providers/types.ts to establish the required interface and types
2. Implement Task 4 in src/users.ts to provide the generic workspace API (getWorkspaceId/setWorkspaceId)
3. Proceed with Task 2 and Task 3 following the TDD (Red -> Green -> Refactor) workflow
