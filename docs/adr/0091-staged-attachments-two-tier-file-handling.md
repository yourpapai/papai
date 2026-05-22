<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0091: Staged Attachments (Two-Tier File Handling)

## Status

Accepted

## Date

2026-05-12

## Context

The papai bot was unconditionally downloading every file from every user in group chats and uploading it to S3. This created several problems:

1. **Cost**: Files from non-authorized users consumed S3 storage even though they were never used
2. **Security**: Files from unauthorized members became visible in the shared workspace
3. **UX**: No mechanism existed for authorized members to explicitly request processing of another member's file
4. **Efficiency**: Every file triggered immediate download and upload regardless of actual need

The system needed to differentiate between:

- File metadata (lightweight, always tracked)
- File bytes (heavy, only stored when explicitly requested by authorized users)

## Decision Drivers

- **Cost reduction**: No S3 storage for files never explicitly requested
- **Security boundary**: Only authorized members can trigger file resolution
- **Explicit consent**: Files should only enter the workspace when a member explicitly asks
- **Platform constraints**: Telegram and Mattermost APIs provide file metadata without downloading bytes
- **Backward compatibility**: DM file handling should remain unchanged (single-user context)

## Decision

We will implement a **Two-Tier Attachment System**:

### Tier 1 — Staged File Cache (SQLite metadata only)

Any file from **any user** (authorized or not) in a group context triggers metadata storage only:

- `staged_id` — internal reference (`stg_<uuid>`)
- `context_id` — group/thread `storageContextId`
- `message_id`, `sender_id`, `sender_username`
- `filename`, `mime_type`, `size`
- `platform_file_id` — Telegram file_id or Mattermost file ID
- `status` — `staged`, `resolved`, `failed`, `expired`
- TTL-based expiration (default: 24 hours)

**No bytes are downloaded. No S3 cost.**

### Tier 2 — Workspace (S3 bytes)

Only when an **authorized member** explicitly requests via `resolve_staged_file` tool:

1. Download bytes from the platform using cached `platform_file_id`
2. Save to S3 via existing `saveAttachment()` workflow
3. Mark staged entry as `resolved`

### DM Context Exception

DMs maintain existing behavior: files go directly to workspace (single participant, implicitly authorized).

## Consequences

### Positive

- **Cost**: Zero S3 storage for files never explicitly requested
- **Security**: Non-member files never enter shared workspace
- **Control**: Explicit user action required to process files
- **Performance**: No eager downloads; metadata tracking is cheap
- **Flexibility**: Support for reply-to-message and natural language references

### Negative

- **Complexity**: Two-tier system adds architectural complexity
- **User experience**: Requires explicit "resolve" action; files not immediately available
- **TTL limitation**: Files must be resolved within 24 hours or re-sent
- **Platform dependency**: Requires platform-specific downloaders (Telegram, Mattermost)

### Risks

- Users may be confused why files aren't immediately available
- **Mitigation**: Prompt enrichment shows staged file availability; clear error messages explain TTL expiration

## Implementation

### Components Created

| Component                            | Responsibility                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/attachments/staged.ts`          | Core cache: `stageFileMetadata`, `searchStagedFiles`, `resolveStagedFile`, `purgeExpiredStagedFiles` |
| `src/attachments/staged-download.ts` | Platform-specific download delegation                                                                |
| `src/bot-attachments.ts`             | Split DM (direct upload) vs group (stage metadata) paths                                             |
| `src/tools/staged-tools.ts`          | LLM tools: `search_staged_files`, `resolve_staged_file`                                              |
| `src/reply-context.ts`               | Prompt enrichment for staged files on reply-to-message                                               |
| `src/scheduler-instance.ts`          | Hourly purge background job                                                                          |

### Database Changes

Migration `031_staged_files.ts` introduces:

- `staged_files` table with indexes
- Migration `032_staged_attachment_id.ts` adds `attachment_id` column
- Migration `033_staged_files_unique_platform_context.ts` adds unique constraint on `platform_file_id` + `context_id`

### Bug Fixes from Original Plan

During implementation, three bugs were identified and fixed:

1. **Unauthorized user files never staged**: Fixed by moving `stageGroupFileCandidates` before `handleMessage`
2. **Thread-scoped context ID mismatch**: Fixed by using `storageContextId` (not `msg.contextId`) for lookups
3. **Adapters eagerly download bytes**: Fixed by introducing `IncomingFileCandidate` type for metadata-only handling

## Alternatives Considered

### Option 1: Keep Unconditional Upload

- **Pros**: Simpler implementation, files immediately available
- **Cons**: Uncontrolled S3 costs, security exposure for non-member files
- **Verdict**: Rejected — cost and security concerns too significant

### Option 2: Block Non-Member Files Entirely

- **Pros**: Zero cost from non-members
- **Cons**: Can't leverage member-to-member file sharing; loses useful functionality
- **Verdict**: Rejected — too user-hostile

### Option 3: Configurable Per-Group

- **Pros**: Flexibility for different group needs
- **Cons**: Additional complexity; unclear value proposition
- **Verdict**: Deferred — start with uniform behavior, revisit if needed

## Related Decisions

- ADR-0028: File Attachments — Original file handling architecture
- `docs/superpowers/specs/2026-05-12-staged-attachments-design.md` — Design specification (archived after acceptance)
- `docs/superpowers/plans/2026-05-12-staged-attachments.md` — Implementation plan (archived after acceptance)

## References

- Implementation: `src/attachments/staged.ts`
- Tests: `tests/attachments/staged.test.ts`, `tests/tools/staged-tools.test.ts`
- Telegram adapter: `src/chat/telegram/file-helpers.ts`
- Mattermost adapter: `src/chat/mattermost/file-helpers.ts`
