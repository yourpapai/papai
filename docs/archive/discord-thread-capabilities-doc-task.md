<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Discord Thread Capabilities Documentation Task

## Task ID

CLEANUP-2026-04-11

## Summary

Add inline code comment to document that Discord's `threadCapabilities.supportsThreads: false` is a deliberate deferral per the design specification, not an oversight.

## Context

### Issue Location

File: `src/chat/discord/index.ts` (lines 55-59)

### Current State

```typescript
readonly threadCapabilities: ThreadCapabilities = {
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}
```

### Design Reference

Per §14 of `docs/discord-chat-design.md` (Non-goals section):

> "Message reactions, **threads**, voice, and stage channels... are not listened for. **Threads are treated as a non-supported channel type and ignored.**"

### Why This Is Correct

- Discord guild channels **do** support threads natively
- Thread support was **explicitly excluded** from Phase 1 scope
- The `supportsThreads: false` setting accurately reflects the approved design
- This is consistent with other non-goals: slash commands, reactions, voice, file attachments (Phase 1)

## Task Requirements

- [x] Add inline comment explaining the deliberate deferral
- [ ] Optional: Add similar note to `CLAUDE.md` Discord section
- [ ] Optional: Consider adding to future Discord Phase 2 planning document

## Implementation

### Change Made

```typescript
readonly threadCapabilities: ThreadCapabilities = {
  // Out of scope per §14 of discord-chat-design.md (Phase 1). Threads are treated as non-supported.
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}
```

### Verification

- [x] Comment references the correct design document section
- [x] Comment explains this is Phase 1 scope limitation
- [x] No functional changes - pure documentation

## Related Documents

- `docs/discord-chat-design.md` §14 - Non-goals section
- `src/chat/discord/index.ts` - Discord chat provider implementation
- `src/chat/types.ts` - ThreadCapabilities type definition

## Future Work

This documentation supports potential Phase 2 implementation where Discord thread support may be added. When that work begins:

1. Review §14 of the design doc to assess thread support scope
2. Update `threadCapabilities` to reflect actual Discord thread capabilities
3. Discord threads are message-scoped (similar to Telegram), not post-scoped
4. Thread creation likely requires `canCreateThreads: true` and Gateway intent adjustments

## Status

**COMPLETED** - Documentation comment added to `src/chat/discord/index.ts`

## Notes

This task was created in response to code review feedback noting that `threadCapabilities` was "hardcoded" to `supportsThreads: false`. The review correctly identified this as a deliberate deferral consistent with the approved design, but flagged it for documentation to prevent future confusion.
