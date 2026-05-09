# Remaining Work: 2026 04 16 proactive group messaging

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-16-proactive-group-messaging.md`

## Completed

_None identified._

## Remaining

- Task 1: Add `DeliveryTarget` type and update `ChatProvider.sendMessage` in `src/chat/types.ts`
- Task 2: Create migration `src/db/migrations/023_proactive_group_targeting.ts` and update `src/db/schema.ts` and `src/db/deferred-schema.ts`
- Tasks 3-5: Update Telegram, Mattermost, and Discord adapters in `src/chat/` to support `DeliveryTarget`
- Task 6: Update domain types in `src/deferred-prompts/types.ts`
- Tasks 7-8: Refactor CRUD functions in `src/deferred-prompts/scheduled.ts` and `src/deferred-prompts/alerts.ts`
- Task 9: Update snapshots in `src/deferred-prompts/snapshots.ts`
- Task 10: Update tool handlers in `src/deferred-prompts/tool-handlers.ts`
- Task 11: Update the poller in `src/deferred-prompts/poller.ts`

## Suggested Next Steps

1. Implement Task 1: Add `DeliveryTarget` to `src/chat/types.ts` and update the `ChatProvider` interface.
2. Implement Task 2: Create the migration file and update the Drizzle schemas to use `context_id` and `context_type`.
3. Update chat adapters (Tasks 3-5) to handle the new `sendMessage` signature.
