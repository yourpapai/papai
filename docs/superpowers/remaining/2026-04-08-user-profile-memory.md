# Remaining Work: 2026 04 08 user profile memory

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-08-user-profile-memory.md`

## Completed

_None identified._

## Remaining

- Task 1: Add migration 019_user_profile and update schema/registries (src/db/)
- Task 2: Implement profile cache slot and sync (src/cache.ts, src/cache-db.ts)
- Task 3: Create profile module skeleton (src/profile.ts)
- Tasks 4-8: Implement profile logic (extractProfile, applyRemember, applyForget, buildProfileContextMessage)
- Task 9: Thread contextType through the LLM orchestrator call chain (src/llm-orchestrator.ts, src/conversation.ts, etc.)
- Task 10: Extend buildMemoryContextMessage to include profile (src/memory.ts)

## Suggested Next Steps

1. Implement Task 1 to create the `user_profile` table and update the database schema.
2. Implement Task 9 to propagate `contextType` through the orchestrator, enabling context-aware gating.
3. Implement Task 3 and 4 to build the core `src/profile.ts` module and extraction logic.
