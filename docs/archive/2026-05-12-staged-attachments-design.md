<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Staged Attachments (Two-Tier File Handling) Design

**Date:** 2026-05-12
**Status:** Approved

## Problem Statement

Today, `handleMessage` in `src/bot.ts` unconditionally calls `ingestAttachmentsForMessage` for every message with files. This means:

- **Any user** in a group who sends a file triggers an immediate download from Telegram and upload to the S3 bucket
- Files from non-authorized users land in the shared workspace and are visible to all members
- There is no way for an authorized member to explicitly ask the bot to process a file that was sent by someone else earlier

## Goals

1. Stop implicitly uploading every file from any user to S3
2. Allow authorized members to explicitly bring a file into the workspace (reply to it or reference it in natural language)
3. Keep the system cost-effective: no S3 storage for files that are never explicitly used
4. Support both deterministic (reply-to-message) and ambiguous (natural language) file references

## Architecture: Two-Tier Attachment System

### Tier 1 — Staged File Cache (metadata only)

When a file arrives from **any user** (authorized or not), the bot stores only **metadata** in SQLite:

- `staged_id` — internal papai reference (`stg_<uuid>`)
- `context_id` — group/thread `storageContextId`
- `message_id` — platform message ID (for reply resolution)
- `sender_id`, `sender_username` — who uploaded it
- `filename`, `mime_type`, `size`
- `platform_file_id` — Telegram `file_id` or Mattermost file ID
- `source_provider` — `telegram`, `mattermost`, `discord`
- `created_at`, `expires_at` — configurable TTL (default: 24h)

**No bytes are downloaded. No S3 cost.**

### Tier 2 — Workspace (bytes in S3)

Only when an **authorized member** explicitly asks the bot to process a staged file does the bot:

1. Download bytes from the platform using the cached `platform_file_id`
2. Call `saveAttachment()` → stores in S3 + SQLite workspace as a normal `AttachmentRef`
3. Mark the staged entry as `resolved` (soft-delete via status)

## Components

### 1. `staged_files` SQLite table

```sql
CREATE TABLE staged_files (
  staged_id         TEXT PRIMARY KEY,
  context_id        TEXT NOT NULL,
  message_id        TEXT,
  sender_id         TEXT NOT NULL,
  sender_username   TEXT,
  filename          TEXT NOT NULL,
  mime_type         TEXT,
  size              INTEGER,
  platform_file_id  TEXT NOT NULL,
  source_provider   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'staged',
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL
)
CREATE INDEX idx_staged_context_sender ON staged_files(context_id, sender_id, expires_at)
CREATE INDEX idx_staged_context_message ON staged_files(context_id, message_id)
CREATE INDEX idx_staged_expires_at ON staged_files(expires_at)
```

**Status values:**

- `staged` — awaiting resolution
- `resolved` — successfully downloaded into workspace
- `failed` — download failed (expired file_id or platform error)
- `expired` — TTL passed, auto-purged

### 2. `src/attachments/staged.ts` — Staged File Cache API

```typescript
export function stageFileMetadata(params: StageFileParams): Promise<StagedFileRef>
export function resolveStagedFile(stagedId: string, contextId: string): Promise<AttachmentRef | StagedResolutionError>
export function searchStagedFiles(contextId: string, query: string, limit?: number): StagedFileRef[]
export function purgeExpiredStagedFiles(): number // returns count purged
```

`resolveStagedFile`:

1. Look up staged metadata by `staged_id` + `context_id`
2. If status is `resolved` or `failed`, return early error
3. If `expires_at` < now, return `{ status: 'staged_file_expired', message: '...' }`
4. Download bytes from platform using `platform_file_id` + `source_provider`
5. Call `saveAttachment()` with the downloaded bytes
6. Update staged status to `resolved`
7. Return the new `AttachmentRef`

**Download failure handling:**

- If platform returns "file not found" or HTTP error, mark as `failed`
- Return `{ status: 'download_failed', message: '...' }`

### 3. `src/attachments/staged-download.ts` — Platform-specific download

```typescript
export function createStagedDownloader(provider: AttachmentSourceProvider): StagedDownloader
```

- **Telegram:** Uses cached `file_id` to call `getFile` → `downloadFile` via the existing grammy bot instance
- **Mattermost:** Uses existing `fetchMattermostFiles` helper with the file ID
- **Discord:** Not applicable (Discord `files.receive` is disabled)

### 4. Bot wiring changes

#### `src/bot.ts` — `handleMessage`

Replace the unconditional `ingestAttachmentsForMessage` call with tiered logic.

**In DMs:**

- Keep existing behavior: files go directly to workspace (the user is the only participant and is authorized)

**In groups:**

- Any file present in a message (regardless of sender authorization):
  - **Stage metadata only** in `staged_files`
  - **Do NOT** call `saveAttachment` immediately (no bytes downloaded, no S3 upload)
- The message is still queued normally if `auth.allowed` and not ignored, but `newAttachmentIds` will be empty (no workspace attachments)
- The prompt enrichment will include staged file candidates if the message references them or replies to them

#### Prompt enrichment for staged files

When `msg.replyContext` points to a message that has staged files, the prompt builder appends a staged-file notice so the LLM knows the file is available to resolve.

### 5. New LLM tools

| Tool                  | Input                             | Output                   | Description                                                       |
| --------------------- | --------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `search_staged_files` | `query: string`, `limit?: number` | `StagedFileRef[]`        | Search staged metadata by sender username or filename             |
| `resolve_staged_file` | `stagedId: string`                | `AttachmentRef` or error | Download bytes from platform, save to workspace, return `att_` ID |

**Naming:** Uses `staged` vocabulary to avoid collision with existing `attachment` tools.

## Error Handling

### Expired staged file

When `resolve_staged_file` is called but `expires_at` has passed:

```json
{
  "status": "staged_file_expired",
  "message": "The bot no longer tracks this file in its cache. Please forward the file to the bot again, or reply directly to the original message containing the file."
}
```

### Download failure

If Telegram returns "file not found" for a still-possibly-valid `file_id`:

```json
{
  "status": "download_failed",
  "message": "Unable to fetch the file from the chat platform. The file may have been removed or the reference expired."
}
```

### Already resolved

If the staged file was already resolved:

```json
{ "status": "already_resolved", "attachmentId": "att_..." }
```

### Duplicate staging

If the same `platform_file_id` + `context_id` pair appears again, update `created_at`, `expires_at`, and `message_id` rather than creating a duplicate row.

## Security and Privacy

- Staged metadata table contains **no file bytes** — only platform IDs and metadata. No S3 cost for non-members.
- Only **authorized members** can trigger `resolve_staged_file`. The tool execution is gated by the existing auth system (tool registration only happens for allowed users).
- Staged entries are **automatically purged** after TTL expires. No long-term storage of non-member activity.
- The cache is **per-context**, so a file staged in group A is never visible in group B.
- A periodic background job (`purgeExpiredStagedFiles`) runs to clean up expired rows.

## Testing Strategy

| Test                                     | What it covers                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `staged-files.test.ts`                   | `stageFileMetadata`, `resolveStagedFile`, `searchStagedFiles`                 |
| `staged-download.test.ts`                | Telegram download mock, failure paths, retry behavior                         |
| `bot.test.ts`                            | Non-member file → staged only, no workspace. Member reply → resolver triggers |
| `tools/staged-tools.test.ts`             | `search_staged_files` and `resolve_staged_file` tool behavior                 |
| `db/migrations/031_staged_files.test.ts` | Table and index creation                                                      |
| `db/schema.test.ts`                      | `stagedFiles` table is exposed through Drizzle                                |

## Migration

New migration `031_staged_files.ts` creates the table and indexes. No changes to existing `attachments` table.

## Rollout

1. Migration + schema (Task 1)
2. Staged cache module + download helpers (Task 2)
3. Bot wiring: stage metadata instead of immediate upload in groups (Task 3)
4. LLM tools: `search_staged_files`, `resolve_staged_file` (Task 4)
5. Prompt enrichment for reply-to-staged-file (Task 5)
6. Background purge job (Task 6)
7. Full test suite + final verification (Task 7)

## Open Questions

None at time of writing. All sections reviewed and approved.
