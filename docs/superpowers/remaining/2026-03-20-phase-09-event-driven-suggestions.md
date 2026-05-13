# Remaining Work: 2026 03 20 phase 09 event driven suggestions

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-03-20-phase-09-event-driven-suggestions.md`

## Completed

- Base tool implementations: `create_task`, `update_task`, `get_task`, `list_tasks`, `search_tasks`, `add_task_relation`
- Core infrastructure: `src/db/index.ts`, `src/db/schema.ts`, `src/types/config.ts`, `src/llm-orchestrator.ts`

## Remaining

- Phase 1: DB Migration (`011_event_suggestions.ts`) and `weekly_state` schema in `src/db/schema.ts`
- Phase 2: Configuration keys in `src/types/config.ts`
- Phase 3: New `src/suggestions/` module (types, service, and tools)
- Phase 4: Tool integration in `src/tools/create-task.ts` and `src/tools/update-task.ts`
- Phase 5: Interactive prompt enhancements in `src/proactive/service.ts`
- Phase 6: Weekly summary/kickoff features in `src/proactive/briefing.ts` and `src/proactive/scheduler.ts`
- Phase 7: Test suites in `tests/suggestions/` and `tests/proactive/`

## Suggested Next Steps

1. Implement Phase 1: Create the `weekly_state` migration and update the Drizzle schema.
2. Implement Phase 2: Extend `ConfigKey` and `CONFIG_KEYS` in `src/types/config.ts`.
3. Implement Phase 3: Develop the `EventSuggestionService` and define the suggestion type structures.
