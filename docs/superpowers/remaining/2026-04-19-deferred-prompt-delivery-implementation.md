# Remaining Work: 2026 04 19 deferred prompt delivery implementation

**Status:** partially_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-19-deferred-prompt-delivery-implementation.md`

## Completed

- Add shared delivery types (DeferredAudience, DeferredDeliveryTarget) to src/chat/types.ts
- Update ChatProvider.sendMessage signature in src/chat/types.ts to use DeferredDeliveryTarget
- Implement database migration 025 (deferred_prompt_delivery_targets) in src/db/migrations/025_deferred_prompt_delivery_targets.ts and src/db/index.ts
- Update database schema with creator and delivery fields in src/db/schema.ts (via deferred-schema.js)
- Define core domain types (DeferredPromptDelivery, DeferredPromptDeliveryInput, deliveryPolicySchema) in src/deferred-prompts/types.ts
- Implement scheduled prompt persistence and CRUD with creator/delivery semantics in src/deferred-prompts/scheduled.ts
- Implement alert prompt persistence and CRUD with creator/delivery semantics in src/deferred-prompts/alerts.ts
- Update poller logic in src/deferred-prompts/poller.ts to group and route delivery by stored target instead of just creator ID
- Update proactive execution in src/deferred-prompts/proactive-llm.ts to use DeferredExecutionContext (incorporating both creator and delivery target)

## Remaining

- Task 6: Capture Delivery Classification at creation time in src/deferred-prompts/tool-handlers.ts, src/tools/create-deferred-prompt.ts, and src/tools/tools-builder.ts
- Task 9: Implement provider-specific proactive delivery (Telegram mentions, Mattermost threads, Discord mentions) in src/chat/telegram/index.ts, src/chat/mattermost/index.ts, and src/chat/discord/index.ts
- Task 10: Complete end-to-end verification and regression testing (tests/chat/proactive-send.test.ts, etc.)

## Suggested Next Steps

1. Prioritize Task 6: Update tool handlers and tool builders to capture 'audience' and 'mention_user_ids' during the creation of deferred prompts.
2. Implement Task 9: Update chat provider adapters to handle the new structured DeferredDeliveryTarget, specifically focusing on Telegram's mention rendering and Mattermost/Discord thread routing.
3. Execute Task 10: Run the full suite of newly created tests to ensure migration safety and correct delivery behavior across all platforms.
