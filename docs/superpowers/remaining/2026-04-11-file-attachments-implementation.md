# Remaining Work: 2026 04 11 file attachments implementation

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-11-file-attachments-implementation.md`

## Completed

_None identified._

## Remaining

- Task 1: Add attachment workspace migration and schema (src/db/migrations/020_attachment_workspace.ts, src/db/schema.ts, etc.)
- Task 2: Implement durable attachment store (src/attachments/store.ts, etc.)
- Task 3: Implement workspace queries, clear behavior, and ingest (src/attachments/workspace.ts, src/attachments/ingest.ts, etc.)
- Task 4: Add resolver rules and stable attachment manifests (src/attachments/resolver.ts, src/reply-context.ts, etc.)
- Task 5: Persist attachments in bot intake and queue stable IDs (src/bot.ts, src/message-queue/queue.ts, etc.)
- Task 6: Move tools and /clear off transient relay (src/tools/upload-attachment.ts, src/commands/clear.ts, src/file-relay.ts)
- Task 7: Send multimodal attachment input to the LLM (src/llm-orchestrator.ts, etc.)
- Task 8: Align Discord capability metadata (src/chat/discord/metadata.ts)

## Suggested Next Steps

1. Start Task 1 by writing failing migration and schema tests in tests/db/migrations/020_attachment_workspace.test.ts and tests/db/schema.test.ts
