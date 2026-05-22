<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0076: Discord Thread Capabilities Documentation

## Status

Accepted

## Date

2026-04-18

## Context

During code review of the Discord chat provider implementation, the `threadCapabilities` configuration in `src/chat/discord/index.ts` was flagged as appearing to be "hardcoded" to `supportsThreads: false` without explanation. This raised questions about whether this was an oversight or a deliberate design decision.

Discord as a platform natively supports threads, unlike the initial assumption. The concern was that the `supportsThreads: false` setting might be:

1. A temporary placeholder that was forgotten
2. An incorrect configuration that should be `true`
3. A deliberate scope limitation that needed documentation

### Design Reference

Upon investigation, the configuration was found to be a deliberate deferral per the Phase 1 design specification. The Discord chat provider design document (§14 Non-goals section, archived at `docs/archive/discord-chat-design-2026-04-09.md`) explicitly states:

> "Message reactions, **threads**, voice, and stage channels... are not listened for. **Threads are treated as a non-supported channel type and ignored.**"

This aligns with other Phase 1 non-goals including slash commands, reactions, voice, and file attachments.

## Decision Drivers

- **Must prevent future confusion** about the `supportsThreads: false` setting
- **Must preserve design intent** documented in the original design specification
- **Should minimize code changes** — this is a documentation-only task
- **Should support future Phase 2 work** by clearly marking what's deferred

## Considered Options

### Option 1: Add inline code comment only

Add a comment directly above the `supportsThreads: false` line explaining the deliberate deferral.

**Pros:**

- Minimal change, immediate clarity for code readers
- References the design document section directly
- No risk of functional changes

**Cons:**

- Only visible to those reading the specific file
- Does not document the broader context for future Phase 2 planning

### Option 2: Update CLAUDE.md Discord section

Add a note to the path-scoped documentation about thread support being deferred.

**Pros:**

- Visible to future developers via CLAUDE.md
- Captures Discord-specific context

**Cons:**

- CLAUDE.md is for coding conventions, not feature scope decisions
- May be overlooked when examining the specific code

### Option 3: Create Discord Phase 2 planning document

Create a forward-looking document capturing deferred features for Phase 2.

**Pros:**

- Sets up future work
- Captures design decisions for when threads are implemented

**Cons:**

- Premature — Phase 2 not currently planned
- May become stale if priorities change

## Decision

Implement **Option 1** (inline code comment) as the primary resolution, with **Option 2** and **Option 3** as optional follow-ups if needed.

The inline comment was added:

```typescript
readonly threadCapabilities: ThreadCapabilities = {
  // Out of scope per §14 of discord-chat-design.md (Phase 1). Threads are treated as non-supported.
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}
```

## Rationale

1. **Code proximity**: Documentation closest to the code it describes is most likely to be seen and maintained
2. **Design reference**: Comment directly references §14 of the design document, allowing future readers to trace the decision
3. **Phase clarity**: Explicitly notes this is a Phase 1 scope limitation, supporting future Phase 2 planning
4. **Consistency**: Aligns with how other non-goals are handled (documented in design spec, not necessarily in code comments)

## Consequences

### Positive

- Future code reviewers will immediately understand the intent
- Reduces risk of someone "fixing" the "hardcoded" value unnecessarily
- Maintains link to original design decision
- Zero functional impact — pure documentation

### Negative

- Single file only — developers not looking at `src/chat/discord/index.ts` won't see it
- Comment may drift from design doc if Phase 2 work proceeds

### Risks

- Risk that design doc archive location changes and comment becomes stale
- Mitigation: Comment uses section reference (§14) which is stable even if file location changes

## Implementation Notes

### Files Changed

- `src/chat/discord/index.ts` — Added inline comment above `threadCapabilities` (lines 52-56)

### Verification

- Comment references correct design document section
- Comment explains Phase 1 scope limitation
- No functional changes — pure documentation

## Related Documents

- Design Document: `docs/archive/discord-chat-design-2026-04-09.md` §14 — Non-goals section
- Implementation: `src/chat/discord/index.ts` — Discord chat provider
- Type Definition: `src/chat/types.ts` — `ThreadCapabilities` interface

## Future Work

If Discord Phase 2 is ever planned:

1. Review §14 of the design doc to assess thread support scope
2. Update `threadCapabilities` to reflect actual Discord thread capabilities
3. Discord threads are message-scoped (similar to Telegram), not post-scoped
4. Thread creation likely requires `canCreateThreads: true` and Gateway intent adjustments

## References

- Original Task Plan: `docs/archive/discord-thread-capabilities-doc-task.md` (archived)
- ADR-0051: Discord Chat Provider (parent decision)
- ADR-0059: Thread-Aware Group Chat (threading abstraction design)
