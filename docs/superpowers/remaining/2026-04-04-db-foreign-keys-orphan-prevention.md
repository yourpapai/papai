# Remaining Work: 2026 04 04 db foreign keys orphan prevention

**Status:** unclear
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-04-db-foreign-keys-orphan-prevention.md`

## Completed

- Update `src/db/schema.ts` with Drizzle `.references()` declarations (partially implemented for recurring tasks/occurrences)
- Implement `removeUser` cache eviction in `src/users.ts`
- Implement orphan cleanup and recurring task cascade in `src/db/migrations/023_add_foreign_keys.ts`

## Remaining

- Complete full migration for all user-referencing tables (currently only `recurring_tasks` and `recurring_task_occurrences` are in `023_add_foreign_keys.ts`)
- Declare all remaining foreign key references in `src/db/schema.ts` (e.g., `user_config`, `conversation_history`, `memory_summary`, etc.)
- Verify full cascade behavior with comprehensive integration tests (e.g., `tests/user-cascade.test.ts`)

## Suggested Next Steps

1. Expand `src/db/migrations/023_add_foreign_keys.ts` to include the remaining 10 tables (user_config, conversation_history, etc.) as specified in the original plan.
2. Update `src/db/schema.ts` to include `.references()` for all tables currently missing them.
3. Create and run a full integration test to verify that `removeUser` triggers a complete cascade delete across all tables.
