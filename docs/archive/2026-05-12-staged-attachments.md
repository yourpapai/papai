<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Staged Attachments (Two-Tier File Handling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unconditional file upload-to-S3 with a two-tier system that stages metadata only for group files and only downloads/resolves files when an authorized member explicitly requests it.

**Architecture:** New `staged_files` SQLite table stores file metadata (platform file ID, sender, filename) without downloading bytes. In DMs, files continue to upload directly to S3. In groups, all files are staged as metadata-only entries — even from unauthorized users — before the auth gate. The adapters are modified to NOT eagerly download bytes for group messages; instead they provide lightweight `IncomingFileCandidate` metadata (file ID, filename, mime type, size) without content. Authorized members use `resolve_staged_file` tool or reply-to-message prompts to trigger download into the workspace. A background purge job removes expired staged entries.

**Tech Stack:** SQLite via Drizzle ORM, existing S3 blob store, Vercel AI SDK `tool()`, Zod v4 schemas, grammy Telegram API, Mattermost REST API.

---

## Bugs Found in Original Plan

Three issues were identified during review that would have broken the "reply to original message" flow:

### Bug 1: Unauthorized users' files never staged

**Problem:** `handleMessage` in `src/bot.ts:169` returns early when `!auth.allowed`, so `ingestAttachmentsForMessage` (which stages metadata) is never reached for non-members. The spec says _"When a file arrives from **any user** (authorized or not)"_.

**Fix:** Extract file staging into `onIncomingMessage`, before `handleMessage`, so ALL group messages stage file metadata regardless of authorization.

### Bug 2: Thread-scoped context ID mismatch

**Problem:** Staged files are stored with `contextId = auth.storageContextId` (e.g. `group-1:thread-42` for threaded groups), but `buildPromptWithReplyContext` looks them up using `msg.contextId` (e.g. `group-1` — no thread suffix). The lookup returns nothing.

**Fix:** Pass `storageContextId` (not `msg.contextId`) to `buildPromptWithReplyContext` and use it for staged file lookups.

### Bug 3: Adapters eagerly download bytes

**Problem:** Telegram adapter (`src/chat/telegram/index.ts:104`) calls `fetchFilesFromContext` which downloads all file bytes before the message reaches `bot.ts`. Mattermost does the same in `fetchFilesForPost`. For group messages this defeats the "no bytes downloaded" goal.

**Fix:** Introduce `IncomingFileCandidate` (metadata only, no `content` buffer). Adapters produce candidates for group messages and full `IncomingFile` (with bytes) for DMs. The staging layer uses candidates; the DM upload path uses full files.

---

## File Structure

| File                                        | Responsibility                                                                                                                                 | Status |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/db/migrations/031_staged_files.ts`     | Migration: creates `staged_files` table + indexes                                                                                              | Create |
| `src/db/index.ts`                           | Registers migration 031                                                                                                                        | Modify |
| `src/db/schema.ts`                          | Drizzle schema for `staged_files` table                                                                                                        | Modify |
| `src/chat/types.ts`                         | Add `IncomingFileCandidate` type (metadata-only, no bytes)                                                                                     | Modify |
| `src/attachments/types.ts`                  | `StagedFileRef`, `StagedFileStatus`, `StageFileParams`, `StagedResolutionError`, `StagedFileDownloadFn` types                                  | Modify |
| `src/attachments/staged.ts`                 | Core staged file cache: `stageFileMetadata`, `resolveStagedFile`, `searchStagedFiles`, `purgeExpiredStagedFiles`, `findStagedFilesByMessageId` | Create |
| `src/attachments/staged-download.ts`        | Platform-specific download: `StagedDownloaderDeps`, `createStagedDownloader`, `setStagedDownloader`, `getStagedDownloader`                     | Create |
| `src/attachments/index.ts`                  | Re-export staged module                                                                                                                        | Modify |
| `src/bot.ts`                                | Extract staging before auth gate; pass `storageContextId` to prompt builder                                                                    | Modify |
| `src/bot-attachments.ts`                    | Split into DM (direct upload) vs group (stage metadata) paths; accept `IncomingFileCandidate[]` for groups                                     | Modify |
| `src/reply-context.ts`                      | Accept `storageContextId` param; use it for staged file lookups instead of `msg.contextId`                                                     | Modify |
| `src/chat/telegram/index.ts`                | Produce `IncomingFileCandidate` for group messages, keep full download for DMs; export `getTelegramFileFetcher`                                | Modify |
| `src/chat/telegram/file-helpers.ts`         | Add `extractFileCandidatesFromContext` (metadata only, no download)                                                                            | Modify |
| `src/chat/mattermost/index.ts`              | Produce `IncomingFileCandidate` for group messages; export `getMattermostFileFetcher`                                                          | Modify |
| `src/chat/mattermost/file-helpers.ts`       | Add `fetchMattermostFileCandidates` (metadata only, no download)                                                                               | Modify |
| `src/tools/staged-tools.ts`                 | `makeSearchStagedFilesTool`, `makeResolveStagedFileTool`                                                                                       | Create |
| `src/tools/tools-builder.ts`                | Register staged tools in `buildTools`                                                                                                          | Modify |
| `src/tools/types.ts`                        | Add `stagedDownloadFn` to `MakeToolsOptions`                                                                                                   | Modify |
| `src/tools/index.ts`                        | Pass `stagedDownloadFn` to `buildTools`                                                                                                        | Modify |
| `src/scheduler-instance.ts`                 | Register `staged-files-purge` background job                                                                                                   | Modify |
| `src/llm-orchestrator.ts`                   | Pass `getStagedDownloader()` to `makeTools`                                                                                                    | Modify |
| `src/index.ts`                              | Initialize staged downloader at startup                                                                                                        | Modify |
| `tests/db/schema.test.ts`                   | `stagedFiles` table Drizzle schema test                                                                                                        | Modify |
| `tests/attachments/staged.test.ts`          | Unit tests for staged cache module + resolve                                                                                                   | Create |
| `tests/attachments/staged-download.test.ts` | Unit tests for platform download factory                                                                                                       | Create |
| `tests/bot-attachments.test.ts`             | Integration tests for DM vs group file handling                                                                                                | Create |
| `tests/tools/staged-tools.test.ts`          | Tool schema and execution tests                                                                                                                | Create |

---

### Task 1: Migration + Drizzle Schema

**Files:**

- Create: `src/db/migrations/031_staged_files.ts`
- Modify: `src/db/index.ts:38,73-104`
- Modify: `src/db/schema.ts:290`
- Test: `tests/db/schema.test.ts:193`

- [ ] **Step 1: Write the failing test in `tests/db/schema.test.ts`**

Add after the existing `attachments schema` describe block (after line 193):

```typescript
describe('stagedFiles schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('exposes the stagedFiles table through Drizzle', () => {
    const db = getDrizzleDb()
    expect(db).toBeDefined()
    expect(stagedFiles.stagedId).toBeDefined()
    expect(stagedFiles.contextId).toBeDefined()
    expect(stagedFiles.messageId).toBeDefined()
    expect(stagedFiles.senderId).toBeDefined()
    expect(stagedFiles.platformFileId).toBeDefined()
    expect(stagedFiles.status).toBeDefined()
    expect(stagedFiles.expiresAt).toBeDefined()
  })

  it('round-trips a staged file row', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()
    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_test',
        contextId: 'ctx-test',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_file_123',
        sourceProvider: 'telegram',
        status: 'staged',
        createdAt: now,
        expiresAt: expires,
      })
      .run()

    const row = db.select().from(stagedFiles).where(eq(stagedFiles.stagedId, 'stg_test')).get()

    expect(row).toBeDefined()
    expect(row!.contextId).toBe('ctx-test')
    expect(row!.status).toBe('staged')
    expect(row!.filename).toBe('report.pdf')
    expect(row!.platformFileId).toBe('tg_file_123')
  })

  it('defaults status to staged', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()
    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_default',
        contextId: 'ctx-test',
        senderId: 'user-1',
        filename: 'doc.txt',
        platformFileId: 'tg_456',
        sourceProvider: 'telegram',
        createdAt: now,
        expiresAt: expires,
      })
      .run()

    const row = db.select().from(stagedFiles).where(eq(stagedFiles.stagedId, 'stg_default')).get()

    expect(row!.status).toBe('staged')
  })
})
```

Add `stagedFiles` to the existing import block:

```typescript
import {
  attachments,
  groupAdminObservations,
  knownGroupContexts,
  stagedFiles,
  userIdentityMappings,
  webCache,
  webRateLimit,
} from '../../src/db/schema.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/schema.test.ts`
Expected: FAIL — `stagedFiles` is not exported from schema

- [ ] **Step 3: Create migration `src/db/migrations/031_staged_files.ts`**

```typescript
import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:031' })

const up = (db: Database): void => {
  db.run(`
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
  `)
  db.run(`CREATE INDEX idx_staged_context_sender ON staged_files(context_id, sender_id, expires_at)`)
  db.run(`CREATE INDEX idx_staged_context_message ON staged_files(context_id, message_id)`)
  db.run(`CREATE INDEX idx_staged_expires_at ON staged_files(expires_at)`)
  log.info('migration 031: staged_files table and indexes created')
}

export const migration031StagedFiles: Migration = {
  id: '031_staged_files',
  up,
}

export default migration031StagedFiles
```

- [ ] **Step 4: Register migration in `src/db/index.ts`**

Add import:

```typescript
import { migration031StagedFiles } from './migrations/031_staged_files.js'
```

Add to `MIGRATIONS` array after `migration030AttachmentWorkspace`:

```typescript
  migration031StagedFiles,
```

- [ ] **Step 5: Add Drizzle schema to `src/db/schema.ts`**

Add after the `attachments` table definition:

```typescript
export const stagedFiles = sqliteTable(
  'staged_files',
  {
    stagedId: text('staged_id').primaryKey(),
    contextId: text('context_id').notNull(),
    messageId: text('message_id'),
    senderId: text('sender_id').notNull(),
    senderUsername: text('sender_username'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    platformFileId: text('platform_file_id').notNull(),
    sourceProvider: text('source_provider').notNull(),
    status: text('status').notNull().default('staged'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_staged_context_sender').on(table.contextId, table.senderId, table.expiresAt),
    index('idx_staged_context_message').on(table.contextId, table.messageId),
    index('idx_staged_expires_at').on(table.expiresAt),
  ],
)
export type StagedFileRow = typeof stagedFiles.$inferSelect
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/db/schema.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/031_staged_files.ts src/db/index.ts src/db/schema.ts tests/db/schema.test.ts
git commit -m "feat: add staged_files migration, schema, and tests"
```

---

### Task 2: Staged File Types + IncomingFileCandidate

**Files:**

- Modify: `src/attachments/types.ts:39`
- Modify: `src/chat/types.ts:73-86`

- [ ] **Step 1: Add staged file types to `src/attachments/types.ts`**

Append after the `SaveAttachmentInput` type:

```typescript
export type StagedFileStatus = 'staged' | 'resolved' | 'failed' | 'expired'

export type StagedFileRef = {
  stagedId: string
  contextId: string
  messageId: string | null
  senderId: string
  senderUsername: string | null
  filename: string
  mimeType: string | null
  size: number | null
  platformFileId: string
  sourceProvider: AttachmentSourceProvider
  status: StagedFileStatus
  createdAt: string
  expiresAt: string
}

export type StageFileParams = {
  contextId: string
  messageId: string | null
  senderId: string
  senderUsername: string | null
  filename: string
  mimeType: string | null
  size: number | null
  platformFileId: string
  sourceProvider: AttachmentSourceProvider
}

export type StagedResolutionError =
  | { status: 'staged_file_expired'; message: string }
  | { status: 'download_failed'; message: string }
  | { status: 'already_resolved'; attachmentId: string }
  | { status: 'not_found'; message: string }

export type StagedFileDownloadFn = (
  platformFileId: string,
  sourceProvider: AttachmentSourceProvider,
) => Promise<Buffer | null>
```

- [ ] **Step 2: Add `IncomingFileCandidate` to `src/chat/types.ts`**

Add after the `IncomingFile` type (after line 86):

```typescript
/** Lightweight file metadata without downloaded content. Used for group file staging where bytes are not needed until resolve. */
export type IncomingFileCandidate = {
  fileId: string
  filename: string
} & Partial<{
  mimeType: string
  size: number
}>
```

- [ ] **Step 3: Add `fileCandidates` optional field to `IncomingMessage`**

Add to the `Partial<{...}>` block of `IncomingMessage` (after the `files` field at line 133):

```typescript
  /** Lightweight file metadata without content (group staging path) */
  fileCandidates: IncomingFileCandidate[]
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/types.ts src/chat/types.ts
git commit -m "feat: add staged file types and IncomingFileCandidate for metadata-only group files"
```

---

### Task 3: Staged File Cache Module

**Files:**

- Create: `src/attachments/staged.ts`
- Modify: `src/attachments/index.ts`
- Test: `tests/attachments/staged.test.ts`

- [ ] **Step 1: Write the failing test in `tests/attachments/staged.test.ts`**

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  findStagedFilesByMessageId,
  purgeExpiredStagedFiles,
  searchStagedFiles,
  stageFileMetadata,
} from '../../src/attachments/staged.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('staged file cache', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('stageFileMetadata', () => {
    test('stores metadata and returns a StagedFileRef', async () => {
      const ref = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_file_123',
        sourceProvider: 'telegram',
      })

      expect(ref.stagedId.startsWith('stg_')).toBe(true)
      expect(ref.contextId).toBe('ctx-1')
      expect(ref.filename).toBe('report.pdf')
      expect(ref.status).toBe('staged')
      expect(ref.platformFileId).toBe('tg_file_123')
      expect(ref.messageId).toBe('msg-1')
    })

    test('generates id with stg_ prefix', async () => {
      const ref = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: null,
        senderId: 'user-1',
        senderUsername: null,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 500,
        platformFileId: 'tg_456',
        sourceProvider: 'telegram',
      })

      expect(ref.stagedId).toMatch(/^stg_[0-9a-f-]+$/)
    })

    test('updates existing entry when same platformFileId + contextId pair appears', async () => {
      const ref1 = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-old',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_dup',
        sourceProvider: 'telegram',
      })

      const ref2 = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-new',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_dup',
        sourceProvider: 'telegram',
      })

      expect(ref1.stagedId).toBe(ref2.stagedId)
      expect(ref2.messageId).toBe('msg-new')
    })
  })

  describe('searchStagedFiles', () => {
    test('finds staged files by sender username', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-2',
        senderId: 'user-2',
        senderUsername: 'bob',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
        platformFileId: 'tg_2',
        sourceProvider: 'telegram',
      })

      const results = searchStagedFiles('ctx-1', 'alice')
      expect(results).toHaveLength(1)
      expect(results[0]!.senderUsername).toBe('alice')
    })

    test('finds staged files by filename substring', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'quarterly_report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      const results = searchStagedFiles('ctx-1', 'report')
      expect(results).toHaveLength(1)
      expect(results[0]!.filename).toBe('quarterly_report.pdf')
    })

    test('scopes results to contextId', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-2',
        messageId: 'msg-2',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1b',
        sourceProvider: 'telegram',
      })

      const results = searchStagedFiles('ctx-1', 'alice')
      expect(results).toHaveLength(1)
      expect(results[0]!.contextId).toBe('ctx-1')
    })

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await stageFileMetadata({
          contextId: 'ctx-1',
          messageId: `msg-${i}`,
          senderId: 'user-1',
          senderUsername: 'alice',
          filename: `file_${i}.pdf`,
          mimeType: 'application/pdf',
          size: 100,
          platformFileId: `tg_${i}`,
          sourceProvider: 'telegram',
        })
      }

      const results = searchStagedFiles('ctx-1', 'alice', 2)
      expect(results).toHaveLength(2)
    })

    test('only returns staged status entries', async () => {
      const ref = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      getDrizzleDb().update(stagedFiles).set({ status: 'resolved' }).where(eq(stagedFiles.stagedId, ref.stagedId)).run()

      const results = searchStagedFiles('ctx-1', 'alice')
      expect(results).toHaveLength(0)
    })
  })

  describe('findStagedFilesByMessageId', () => {
    test('finds staged files by message ID within a context', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-target',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-other',
        senderId: 'user-2',
        senderUsername: 'bob',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
        platformFileId: 'tg_2',
        sourceProvider: 'telegram',
      })

      const results = findStagedFilesByMessageId('ctx-1', 'msg-target')
      expect(results).toHaveLength(1)
      expect(results[0]!.filename).toBe('report.pdf')
    })

    test('returns empty array for unknown message ID', () => {
      const results = findStagedFilesByMessageId('ctx-1', 'msg-nonexistent')
      expect(results).toHaveLength(0)
    })
  })

  describe('purgeExpiredStagedFiles', () => {
    test('removes entries past their expires_at', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'old.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_old',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')

      getDrizzleDb().update(sf).set({ status: 'expired' }).where(eq(sf.platformFileId, 'tg_old')).run()

      const purged = purgeExpiredStagedFiles()
      expect(purged).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/attachments/staged.test.ts`
Expected: FAIL — cannot resolve `../../src/attachments/staged.js`

- [ ] **Step 3: Create `src/attachments/staged.ts`**

```typescript
import { randomUUID } from 'node:crypto'

import { and, eq, like, or, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { stagedFiles } from '../db/schema.js'
import { logger } from '../logger.js'
import type {
  AttachmentRef,
  AttachmentSourceProvider,
  StageFileParams,
  StagedFileDownloadFn,
  StagedFileRef,
  StagedResolutionError,
} from './types.js'
import { saveAttachment } from './store.js'

const log = logger.child({ scope: 'attachments:staged' })

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const toRef = (row: typeof stagedFiles.$inferSelect): StagedFileRef => ({
  stagedId: row.stagedId,
  contextId: row.contextId,
  messageId: row.messageId,
  senderId: row.senderId,
  senderUsername: row.senderUsername,
  filename: row.filename,
  mimeType: row.mimeType,
  size: row.size,
  platformFileId: row.platformFileId,
  sourceProvider: row.sourceProvider as AttachmentSourceProvider,
  status: row.status as StagedFileRef['status'],
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
})

export async function stageFileMetadata(params: StageFileParams): Promise<StagedFileRef> {
  const db = getDrizzleDb()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS)

  const existing = db
    .select()
    .from(stagedFiles)
    .where(and(eq(stagedFiles.platformFileId, params.platformFileId), eq(stagedFiles.contextId, params.contextId)))
    .get()

  if (existing !== undefined) {
    const nowIso = now.toISOString()
    const expiresIso = expiresAt.toISOString()
    db.update(stagedFiles)
      .set({
        messageId: params.messageId ?? null,
        senderId: params.senderId,
        senderUsername: params.senderUsername ?? null,
        filename: params.filename,
        mimeType: params.mimeType ?? null,
        size: params.size ?? null,
        createdAt: nowIso,
        expiresAt: expiresIso,
        status: 'staged',
      })
      .where(eq(stagedFiles.stagedId, existing.stagedId))
      .run()

    log.debug({ stagedId: existing.stagedId }, 'Updated existing staged file metadata')
    return toRef({
      ...existing,
      messageId: params.messageId ?? null,
      createdAt: nowIso,
      expiresAt: expiresIso,
      status: 'staged',
    })
  }

  const stagedId = `stg_${randomUUID()}`
  const nowIso = now.toISOString()
  const expiresIso = expiresAt.toISOString()

  db.insert(stagedFiles)
    .values({
      stagedId,
      contextId: params.contextId,
      messageId: params.messageId ?? null,
      senderId: params.senderId,
      senderUsername: params.senderUsername ?? null,
      filename: params.filename,
      mimeType: params.mimeType ?? null,
      size: params.size ?? null,
      platformFileId: params.platformFileId,
      sourceProvider: params.sourceProvider,
      status: 'staged',
      createdAt: nowIso,
      expiresAt: expiresIso,
    })
    .run()

  log.info({ stagedId, contextId: params.contextId, filename: params.filename }, 'Staged file metadata')
  return toRef({
    stagedId,
    contextId: params.contextId,
    messageId: params.messageId ?? null,
    senderId: params.senderId,
    senderUsername: params.senderUsername ?? null,
    filename: params.filename,
    mimeType: params.mimeType ?? null,
    size: params.size ?? null,
    platformFileId: params.platformFileId,
    sourceProvider: params.sourceProvider,
    status: 'staged',
    createdAt: nowIso,
    expiresAt: expiresIso,
  })
}

export function searchStagedFiles(contextId: string, query: string, limit: number = 10): StagedFileRef[] {
  const db = getDrizzleDb()
  const pattern = `%${query}%`

  return db
    .select()
    .from(stagedFiles)
    .where(
      and(
        eq(stagedFiles.contextId, contextId),
        eq(stagedFiles.status, 'staged'),
        or(like(stagedFiles.senderUsername, pattern), like(stagedFiles.filename, pattern)),
      ),
    )
    .limit(limit)
    .all()
    .map(toRef)
}

export function findStagedFilesByMessageId(contextId: string, messageId: string): StagedFileRef[] {
  const db = getDrizzleDb()
  return db
    .select()
    .from(stagedFiles)
    .where(
      and(eq(stagedFiles.contextId, contextId), eq(stagedFiles.messageId, messageId), eq(stagedFiles.status, 'staged')),
    )
    .all()
    .map(toRef)
}

export function purgeExpiredStagedFiles(): number {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  const result = db
    .delete()
    .from(stagedFiles)
    .where(sql`${stagedFiles.status} = 'expired' OR ${stagedFiles.expiresAt} < ${now}`)
    .run()

  const count = result.changes
  if (count > 0) log.info({ count }, 'Purged expired staged files')
  return count
}

export async function resolveStagedFile(
  stagedId: string,
  contextId: string,
  downloadFn: StagedFileDownloadFn,
): Promise<AttachmentRef | StagedResolutionError> {
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(stagedFiles)
    .where(and(eq(stagedFiles.stagedId, stagedId), eq(stagedFiles.contextId, contextId)))
    .get()

  if (row === undefined) {
    return {
      status: 'not_found',
      message: `Staged file ${stagedId} not found in context ${contextId}.`,
    }
  }

  if (row.status === 'resolved') {
    return { status: 'already_resolved', attachmentId: 'unknown' }
  }

  if (row.status === 'failed') {
    return {
      status: 'download_failed',
      message: 'Previous download attempt failed. Please re-send the file.',
    }
  }

  const now = new Date()
  if (new Date(row.expiresAt) < now) {
    db.update(stagedFiles).set({ status: 'expired' }).where(eq(stagedFiles.stagedId, stagedId)).run()
    return {
      status: 'staged_file_expired',
      message:
        'The file cache entry has expired (files are tracked for 24 hours). Ask the sender to re-send or forward the file to the group so it can be staged again.',
    }
  }

  const content = await downloadFn(row.platformFileId, row.sourceProvider as AttachmentSourceProvider)
  if (content === null) {
    db.update(stagedFiles).set({ status: 'failed' }).where(eq(stagedFiles.stagedId, stagedId)).run()
    return {
      status: 'download_failed',
      message:
        'Unable to fetch the file from the chat platform. The file may have been removed or the reference expired.',
    }
  }

  const attachmentRef = await saveAttachment({
    contextId: row.contextId,
    sourceProvider: row.sourceProvider as AttachmentSourceProvider,
    filename: row.filename,
    mimeType: row.mimeType ?? undefined,
    size: row.size ?? undefined,
    content,
    status: 'available',
    sourceMessageId: row.messageId ?? undefined,
    sourceFileId: row.platformFileId,
  })

  db.update(stagedFiles).set({ status: 'resolved' }).where(eq(stagedFiles.stagedId, stagedId)).run()

  log.info({ stagedId, attachmentId: attachmentRef.attachmentId }, 'Staged file resolved into workspace')
  return attachmentRef
}
```

- [ ] **Step 4: Export staged module from `src/attachments/index.ts`**

Replace the type re-exports block with:

```typescript
export type {
  AttachmentRef,
  AttachmentSourceProvider,
  AttachmentStatus,
  SaveAttachmentInput,
  StagedFileDownloadFn,
  StagedFileRef,
  StagedFileStatus,
  StagedResolutionError,
  StageFileParams,
  StoredAttachment,
} from './types.js'
```

Add after the `persistIncomingAttachments` export:

```typescript
export {
  findStagedFilesByMessageId,
  purgeExpiredStagedFiles,
  resolveStagedFile,
  searchStagedFiles,
  stageFileMetadata,
} from './staged.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/attachments/staged.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/attachments/staged.ts src/attachments/index.ts tests/attachments/staged.test.ts
git commit -m "feat: add staged file cache module (stage, search, resolve, purge)"
```

---

### Task 4: Staged Download Module

**Files:**

- Create: `src/attachments/staged-download.ts`
- Test: `tests/attachments/staged-download.test.ts`

- [ ] **Step 1: Write the failing test in `tests/attachments/staged-download.test.ts`**

```typescript
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { createStagedDownloader } from '../../src/attachments/staged-download.js'
import type { StagedFileDownloadFn } from '../../src/attachments/types.js'

describe('staged download factory', () => {
  let downloadFn: StagedFileDownloadFn

  describe('telegram provider', () => {
    const mockFetcher = mock<(fileId: string) => Promise<Buffer | null>>(async (fileId: string) => {
      if (fileId === 'tg_valid') return Buffer.from('tg-bytes')
      return null
    })

    beforeEach(() => {
      mock.restore()
      downloadFn = createStagedDownloader({
        telegramFetcher: mockFetcher,
        mattermostFetcher: async () => null,
      })
    })

    test('delegates to telegramFetcher for telegram source', async () => {
      const result = await downloadFn('tg_valid', 'telegram')
      expect(result).not.toBeNull()
      expect(result!.toString()).toBe('tg-bytes')
      expect(mockFetcher).toHaveBeenCalledWith('tg_valid')
    })

    test('returns null for missing telegram file', async () => {
      const result = await downloadFn('tg_missing', 'telegram')
      expect(result).toBeNull()
    })
  })

  describe('mattermost provider', () => {
    const mockFetcher = mock<(fileId: string) => Promise<Buffer | null>>(async (fileId: string) => {
      if (fileId === 'mm_valid') return Buffer.from('mm-bytes')
      return null
    })

    beforeEach(() => {
      mock.restore()
      downloadFn = createStagedDownloader({
        telegramFetcher: async () => null,
        mattermostFetcher: mockFetcher,
      })
    })

    test('delegates to mattermostFetcher for mattermost source', async () => {
      const result = await downloadFn('mm_valid', 'mattermost')
      expect(result).not.toBeNull()
      expect(result!.toString()).toBe('mm-bytes')
      expect(mockFetcher).toHaveBeenCalledWith('mm_valid')
    })

    test('returns null for missing mattermost file', async () => {
      const result = await downloadFn('mm_missing', 'mattermost')
      expect(result).toBeNull()
    })
  })

  describe('discord provider', () => {
    beforeEach(() => {
      downloadFn = createStagedDownloader({
        telegramFetcher: async () => null,
        mattermostFetcher: async () => null,
      })
    })

    test('returns null for discord (not supported)', async () => {
      const result = await downloadFn('discord_123', 'discord')
      expect(result).toBeNull()
    })
  })

  describe('unknown provider', () => {
    beforeEach(() => {
      downloadFn = createStagedDownloader({
        telegramFetcher: async () => null,
        mattermostFetcher: async () => null,
      })
    })

    test('returns null for unknown provider', async () => {
      const result = await downloadFn('x_123', 'unknown')
      expect(result).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/attachments/staged-download.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Create `src/attachments/staged-download.ts`**

```typescript
import type { AttachmentSourceProvider, StagedFileDownloadFn } from './types.js'

export type StagedDownloaderDeps = {
  telegramFetcher: (fileId: string) => Promise<Buffer | null>
  mattermostFetcher: (fileId: string) => Promise<Buffer | null>
}

let activeDownloader: StagedFileDownloadFn | null = null

export function createStagedDownloader(deps: StagedDownloaderDeps): StagedFileDownloadFn {
  return async (platformFileId: string, sourceProvider: AttachmentSourceProvider): Promise<Buffer | null> => {
    switch (sourceProvider) {
      case 'telegram':
        return deps.telegramFetcher(platformFileId)
      case 'mattermost':
        return deps.mattermostFetcher(platformFileId)
      default:
        return null
    }
  }
}

export function setStagedDownloader(fn: StagedFileDownloadFn): void {
  activeDownloader = fn
}

export function getStagedDownloader(): StagedFileDownloadFn | null {
  return activeDownloader
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/attachments/staged-download.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/staged-download.ts tests/attachments/staged-download.test.ts
git commit -m "feat: add staged download factory with platform-specific delegation"
```

---

### Task 5: Bot Wiring — Stage Before Auth Gate + Thread-Safe Context IDs

This is the core bug-fix task. It moves file staging into `onIncomingMessage` (before auth) and ensures the thread-scoped `storageContextId` is used consistently for both staging and lookup.

**Files:**

- Modify: `src/bot.ts:162-194,225-257`
- Modify: `src/bot-attachments.ts:1-38`
- Modify: `src/reply-context.ts:112-134`
- Create: `tests/bot-attachments.test.ts`

- [ ] **Step 1: Write the failing test in `tests/bot-attachments.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { _createInMemoryBlobStore, _resetBlobStore, _setBlobStore } from '../src/attachments/blob-store.js'
import { listActiveAttachments } from '../src/attachments/index.js'
import { findStagedFilesByMessageId } from '../src/attachments/staged.js'
import { stageGroupFileCandidates } from '../src/bot-attachments.js'
import { mockLogger, setupTestDb, createDmMessage, createGroupMessage, createMockChat } from './utils/test-helpers.js'
import type { IncomingFile, IncomingFileCandidate, IncomingMessage } from '../src/chat/types.js'

const makeFile = (overrides: Partial<IncomingFile> = {}): IncomingFile => ({
  fileId: 'f-1',
  filename: 'report.pdf',
  content: Buffer.from('pdf-data'),
  mimeType: 'application/pdf',
  size: 8,
  ...overrides,
})

const makeCandidate = (overrides: Partial<IncomingFileCandidate> = {}): IncomingFileCandidate => ({
  fileId: 'f-1',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  size: 8,
  ...overrides,
})

const makeDmMsg = (files: IncomingFile[]): IncomingMessage => ({
  ...createDmMessage('dm-user'),
  files,
})

const makeGroupMsg = (candidates: IncomingFileCandidate[], messageId = 'msg-1'): IncomingMessage => ({
  ...createGroupMessage('group-1', 'group-user'),
  messageId,
  fileCandidates: candidates,
})

describe('bot-attachments', () => {
  let blobs: ReturnType<typeof _createInMemoryBlobStore>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    blobs = _createInMemoryBlobStore()
    _setBlobStore(blobs)
  })

  afterEach(() => {
    _resetBlobStore()
  })

  describe('DM context', () => {
    test('uploads files directly to workspace', async () => {
      const { provider } = createMockChat({ name: 'telegram' })
      const msg = makeDmMsg([makeFile()])

      const { ingestDmAttachments } = await import('../src/bot-attachments.js')
      const result = await ingestDmAttachments({
        chat: provider,
        msg,
        storageContextId: 'dm-user',
        files: msg.files!,
      })

      expect(result.newAttachmentIds).toHaveLength(1)
      expect(result.newAttachmentIds[0]!.startsWith('att_')).toBe(true)
      expect(listActiveAttachments('dm-user')).toHaveLength(1)
    })
  })

  describe('group context — stageGroupFileCandidates', () => {
    test('stages metadata only, does not upload to workspace', async () => {
      const storageContextId = 'group-1'
      const msg = makeGroupMsg([makeCandidate({ fileId: 'tg_platform_123' })], 'msg-42')

      await stageGroupFileCandidates({
        storageContextId,
        msg,
        sourceProvider: 'telegram',
      })

      expect(listActiveAttachments(storageContextId)).toHaveLength(0)
      const staged = findStagedFilesByMessageId(storageContextId, 'msg-42')
      expect(staged).toHaveLength(1)
      expect(staged[0]!.platformFileId).toBe('tg_platform_123')
      expect(staged[0]!.filename).toBe('report.pdf')
      expect(staged[0]!.status).toBe('staged')
    })

    test('uses thread-scoped storageContextId for lookup', async () => {
      const threadScopedId = 'group-1:thread-42'
      const msg = makeGroupMsg([makeCandidate({ fileId: 'tg_threaded' })], 'msg-thread')

      await stageGroupFileCandidates({
        storageContextId: threadScopedId,
        msg,
        sourceProvider: 'telegram',
      })

      const staged = findStagedFilesByMessageId(threadScopedId, 'msg-thread')
      expect(staged).toHaveLength(1)
      expect(staged[0]!.contextId).toBe('group-1:thread-42')
    })

    test('stages multiple files from a single message', async () => {
      const msg = makeGroupMsg(
        [makeCandidate({ fileId: 'f-1', filename: 'a.pdf' }), makeCandidate({ fileId: 'f-2', filename: 'b.jpg' })],
        'msg-multi',
      )

      await stageGroupFileCandidates({
        storageContextId: 'group-1',
        msg,
        sourceProvider: 'telegram',
      })

      const staged = findStagedFilesByMessageId('group-1', 'msg-multi')
      expect(staged).toHaveLength(2)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/bot-attachments.test.ts`
Expected: FAIL — `stageGroupFileCandidates` not exported

- [ ] **Step 3: Replace `src/bot-attachments.ts`**

```typescript
import { listActiveAttachments, persistIncomingAttachments, stageFileMetadata } from './attachments/index.js'
import type { AttachmentRef, AttachmentSourceProvider } from './attachments/types.js'
import type { ChatProvider, IncomingFile, IncomingFileCandidate, IncomingMessage } from './chat/types.js'

const SOURCE_BY_NAME: Readonly<Record<string, AttachmentSourceProvider>> = {
  telegram: 'telegram',
  mattermost: 'mattermost',
  discord: 'discord',
}

const toSourceProvider = (name: string): AttachmentSourceProvider => SOURCE_BY_NAME[name] ?? 'unknown'

export type IngestDmAttachmentsParams = {
  chat: ChatProvider
  msg: IncomingMessage
  storageContextId: string
  files: readonly IncomingFile[]
}

export type IngestAttachmentsResult = {
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}

export type StageGroupCandidatesParams = {
  storageContextId: string
  msg: IncomingMessage
  sourceProvider: AttachmentSourceProvider
}

export async function ingestDmAttachments(params: IngestDmAttachmentsParams): Promise<IngestAttachmentsResult> {
  const persistParams: Parameters<typeof persistIncomingAttachments>[0] = {
    contextId: params.storageContextId,
    sourceProvider: toSourceProvider(params.chat.name),
    files: params.files,
  }
  if (params.msg.messageId !== undefined) persistParams.sourceMessageId = params.msg.messageId
  const newRefs = await persistIncomingAttachments(persistParams)
  const activeAttachments = listActiveAttachments(params.storageContextId)
  return {
    newAttachmentIds: newRefs.map((ref) => ref.attachmentId),
    activeAttachments,
  }
}

export async function stageGroupFileCandidates(params: StageGroupCandidatesParams): Promise<void> {
  const candidates: readonly IncomingFileCandidate[] = params.msg.fileCandidates ?? []
  for (const candidate of candidates) {
    await stageFileMetadata({
      contextId: params.storageContextId,
      messageId: params.msg.messageId ?? null,
      senderId: params.msg.user.id,
      senderUsername: params.msg.user.username ?? null,
      filename: candidate.filename,
      mimeType: candidate.mimeType ?? null,
      size: candidate.size ?? null,
      platformFileId: candidate.fileId,
      sourceProvider: params.sourceProvider,
    })
  }
}
```

- [ ] **Step 4: Modify `src/bot.ts` — stage before auth gate**

The key change: call `stageGroupFileCandidates` in `onIncomingMessage` BEFORE the auth check in `handleMessage`. This ensures ALL group files get staged.

Add import at top of `src/bot.ts`:

```typescript
import { ingestDmAttachments, stageGroupFileCandidates } from './bot-attachments.js'
import type { AttachmentSourceProvider } from './attachments/types.js'
```

Modify `onIncomingMessage` to stage group file candidates before calling `handleMessage`. Add between the wizard interception check and `handleMessage` call (after line 253, before line 255):

```typescript
if (msg.contextType === 'group' && msg.fileCandidates !== undefined && msg.fileCandidates.length > 0) {
  const sourceProvider: AttachmentSourceProvider =
    chat.name === 'telegram'
      ? 'telegram'
      : chat.name === 'mattermost'
        ? 'mattermost'
        : chat.name === 'discord'
          ? 'discord'
          : 'unknown'
  await stageGroupFileCandidates({
    storageContextId: auth.storageContextId,
    msg,
    sourceProvider,
  })
}
```

Now modify `handleMessage` to only handle DM file uploads (group files are already staged above):

Replace the `handleMessage` function body:

```typescript
async function handleMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  if (!auth.allowed) {
    if (msg.isMentioned) await replyToUnauthorized(reply, auth)
    return
  }
  if (shouldIgnoreGroupMessage(msg)) return

  let newAttachmentIds: readonly string[] = []
  let activeAttachments: readonly AttachmentRef[] = []

  if (msg.contextType === 'dm') {
    const files: readonly IncomingFile[] = msg.files ?? []
    if (files.length > 0) {
      const result = await ingestDmAttachments({
        chat,
        msg,
        storageContextId: auth.storageContextId,
        files,
      })
      newAttachmentIds = result.newAttachmentIds
      activeAttachments = result.activeAttachments
    }
  } else {
    activeAttachments = listActiveAttachments(auth.storageContextId)
  }

  enqueueMessage(
    {
      text: buildPromptWithReplyContext(msg, activeAttachments, auth.storageContextId),
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      newAttachmentIds,
    },
    reply,
    (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
  )
}
```

Add the missing imports:

```typescript
import { listActiveAttachments } from './attachments/index.js'
import type { AttachmentRef } from './chat/types.js'
```

Note: `AttachmentRef` is actually from `./attachments/types.js`, not `./chat/types.js`. Use:

```typescript
import { listActiveAttachments } from './attachments/index.js'
import type { AttachmentRef } from './attachments/types.js'
```

- [ ] **Step 5: Modify `src/reply-context.ts` — accept `storageContextId`**

Update `buildPromptWithReplyContext` signature and use `storageContextId` for staged file lookups:

```typescript
import { findStagedFilesByMessageId } from './attachments/staged.js'

export function buildPromptWithReplyContext(
  msg: IncomingMessage,
  attachments: readonly AttachmentRef[] = [],
  storageContextId?: string,
): string {
  if (!hasContextData(msg, attachments) && msg.replyToMessageId === undefined) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext !== undefined) {
    logReplyContextDebug(msg)
    context.push(...buildReplyContextLines(msg))
  }

  const manifest = buildAttachmentManifest(attachments)
  if (manifest !== null) context.push(manifest)

  if (msg.replyToMessageId !== undefined && storageContextId !== undefined) {
    const stagedForReply = findStagedFilesByMessageId(storageContextId, msg.replyToMessageId)
    if (stagedForReply.length > 0) {
      const stagedLines = stagedForReply.map(
        (sf) => `[Staged file available: ${sf.stagedId} "${sf.filename}" from ${sf.senderUsername ?? 'unknown user'}]`,
      )
      context.push(...stagedLines)
    }
  }

  if (context.length === 0) {
    return msg.text
  }

  const finalPrompt = context.join('\n') + '\n\n' + msg.text
  logPromptBuilt(context.length, finalPrompt, msg.text)
  return finalPrompt
}
```

Update `hasContextData` to not gate on staged files (since we now check `replyToMessageId` separately):

```typescript
function hasContextData(msg: IncomingMessage, attachments: readonly AttachmentRef[]): boolean {
  const hasReplyContext = msg.replyContext !== undefined
  const hasAttachments = attachments.length > 0
  return hasReplyContext || hasAttachments
}
```

- [ ] **Step 6: Run tests to verify**

Run: `bun test tests/bot-attachments.test.ts tests/bot.test.ts tests/attachments/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/bot.ts src/bot-attachments.ts src/reply-context.ts tests/bot-attachments.test.ts
git commit -m "feat: stage group files before auth gate, use thread-scoped context IDs for lookups"
```

---

### Task 6: Telegram Adapter — File Candidates for Groups

**Files:**

- Modify: `src/chat/telegram/file-helpers.ts`
- Modify: `src/chat/telegram/index.ts:89-109,264-299`

- [ ] **Step 1: Add `extractFileCandidatesFromContext` to `src/chat/telegram/file-helpers.ts`**

This function extracts file metadata without downloading bytes. Add after the existing `extractFilesFromContext`:

```typescript
export function extractFileCandidatesFromContext(ctx: ExtractFilesInput): IncomingFileCandidate[] {
  return buildFileCandidates(ctx.message)
}
```

Add the import for `IncomingFileCandidate`:

```typescript
import type { IncomingFile } from '../types.js'
import type { IncomingFileCandidate } from '../types.js'
```

- [ ] **Step 2: Modify Telegram `onMessage` in `src/chat/telegram/index.ts`**

Split the file message handler to use candidates for groups and full downloads for DMs. Replace the file message handler (lines 98-109):

```typescript
this.bot.on(['message:document', 'message:photo', 'message:audio', 'message:video', 'message:voice'], async (ctx) => {
  const isAdmin = await this.checkAdminStatus(ctx)
  const msg = await this.extractMessage(ctx, isAdmin)
  if (msg === null) return

  if (msg.contextType === 'group') {
    const candidates = extractFileCandidatesFromContext(ctx)
    if (candidates.length > 0) msg.fileCandidates = candidates
  } else {
    const files = await this.fetchFilesFromContext(ctx)
    if (files.length > 0) msg.files = files
  }

  const reply = this.buildReplyFn(ctx, msg.threadId, false)
  await handler(msg, reply)
})
```

Add the import:

```typescript
import { extractFileCandidatesFromContext } from './file-helpers.js'
```

- [ ] **Step 3: Add `getTelegramFileFetcher` export**

Add to the `TelegramChatProvider` class or as a module-level export. This returns the file-fetching closure for use by the staged downloader at resolve time:

```typescript
export function getTelegramFileFetcher(): ((fileId: string) => Promise<Buffer | null>) | undefined {
  return telegramFileFetcher
}
```

Store the fetcher as a module-level variable when the bot is initialized. In the constructor or `start` method, capture it:

```typescript
let telegramFileFetcher: ((fileId: string) => Promise<Buffer | null>) | undefined
```

In the `fetchFilesFromContext` method or wherever the fetcher is created, also assign to the module variable:

```typescript
private fetchFilesFromContext(ctx: Context): Promise<IncomingFile[]> {
  const envToken = process.env['TELEGRAM_BOT_TOKEN']
  let token = ''
  if (envToken !== undefined) {
    token = envToken
  }
  const fetcher: TelegramFileFetcher = async (fileId: string) => {
    // ... existing implementation
  }
  telegramFileFetcher = fetcher
  return extractFilesFromContext(ctx, fetcher)
}
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/telegram/file-helpers.ts src/chat/telegram/index.ts
git commit -m "feat: telegram adapter produces file candidates for groups (no eager download)"
```

---

### Task 7: Mattermost Adapter — File Candidates for Groups

**Files:**

- Modify: `src/chat/mattermost/file-helpers.ts`
- Modify: `src/chat/mattermost/index.ts`

- [ ] **Step 1: Add `fetchMattermostFileCandidates` to `src/chat/mattermost/file-helpers.ts`**

This fetches file metadata (name, mime type, size, file ID) without downloading content:

```typescript
export async function fetchMattermostFileCandidates(
  fileIds: string[],
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): Promise<IncomingFileCandidate[]> {
  const candidates = await Promise.all(
    fileIds.map(async (fileId): Promise<IncomingFileCandidate | null> => {
      try {
        const infoData = await apiFetch('GET', `/api/v4/files/${fileId}/info`, undefined)
        const parsed = MattermostFileInfoSchema.safeParse(infoData)
        if (!parsed.success) return null
        return {
          fileId,
          filename: parsed.data.name,
          mimeType: parsed.data.mime_type,
          size: parsed.data.size,
        }
      } catch {
        return null
      }
    }),
  )
  return candidates.filter((c): c is IncomingFileCandidate => c !== null)
}
```

Add the import for `IncomingFileCandidate`:

```typescript
import type { IncomingFile, IncomingFileCandidate } from '../types.js'
```

- [ ] **Step 2: Modify Mattermost `buildPostedMessage` in `src/chat/mattermost/index.ts`**

Use candidates for group messages, full download for DMs. Find where `fetchFilesForPost` is called and split:

```typescript
let files: IncomingFile[] | undefined
let fileCandidates: IncomingFileCandidate[] | undefined

if (contextType === 'group') {
  fileCandidates = await this.fetchFileCandidatesForPost(post)
  if (fileCandidates !== undefined && fileCandidates.length === 0) fileCandidates = undefined
} else {
  files = await this.fetchFilesForPost(post)
}
```

Update the message construction to include `fileCandidates`:

```typescript
      ...(files !== undefined && files.length > 0 ? { files } : {}),
      ...(fileCandidates !== undefined && fileCandidates.length > 0 ? { fileCandidates } : {}),
```

Add the `fetchFileCandidatesForPost` method:

```typescript
  private fetchFileCandidatesForPost(post: MattermostPost): Promise<IncomingFileCandidate[] | undefined> {
    if (post.file_ids === undefined || post.file_ids.length === 0) return Promise.resolve(void 0)
    return fetchMattermostFileCandidates(post.file_ids, this.apiFetch.bind(this))
  }
```

Add the import:

```typescript
import { fetchMattermostFileCandidates } from './file-helpers.js'
```

- [ ] **Step 3: Add `getMattermostFileFetcher` export**

```typescript
export function getMattermostFileFetcher(): ((fileId: string) => Promise<Buffer | null>) | undefined {
  return mattermostFileFetcher
}
```

Store the fetcher at module level:

```typescript
let mattermostFileFetcher: ((fileId: string) => Promise<Buffer | null>) | undefined
```

In the constructor or initialization, capture it:

```typescript
mattermostFileFetcher = (fileId: string) => downloadMattermostFile(this.baseUrl, this.token, fileId)
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/file-helpers.ts src/chat/mattermost/index.ts
git commit -m "feat: mattermost adapter produces file candidates for groups (no eager download)"
```

---

### Task 8: LLM Tools — search_staged_files and resolve_staged_file

**Files:**

- Create: `src/tools/staged-tools.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `src/tools/types.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/tools/staged-tools.test.ts`

- [ ] **Step 1: Write the failing test in `tests/tools/staged-tools.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { _createInMemoryBlobStore, _resetBlobStore, _setBlobStore } from '../../src/attachments/blob-store.js'
import { stageFileMetadata } from '../../src/attachments/staged.js'
import { makeResolveStagedFileTool, makeSearchStagedFilesTool } from '../../src/tools/staged-tools.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'ctx-staged-tools'

describe('staged file tools', () => {
  let downloadCalls: Array<{ platformFileId: string }>

  const mockDownloadFn = async (platformFileId: string): Promise<Buffer | null> => {
    downloadCalls.push({ platformFileId })
    if (platformFileId === 'tg_fail') return null
    return Buffer.from('resolved-bytes')
  }

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
    _setBlobStore(_createInMemoryBlobStore())
    downloadCalls = []

    await stageFileMetadata({
      contextId: CTX,
      messageId: 'msg-1',
      senderId: 'user-1',
      senderUsername: 'alice',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      platformFileId: 'tg_123',
      sourceProvider: 'telegram',
    })

    await stageFileMetadata({
      contextId: CTX,
      messageId: 'msg-2',
      senderId: 'user-2',
      senderUsername: 'bob',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      size: 50,
      platformFileId: 'tg_456',
      sourceProvider: 'telegram',
    })
  })

  afterEach(() => {
    _resetBlobStore()
  })

  describe('search_staged_files', () => {
    test('has correct description', () => {
      const t = makeSearchStagedFilesTool(CTX)
      expect(t.description).toContain('staged')
    })

    test('schema requires query', () => {
      const t = makeSearchStagedFilesTool(CTX)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { query: 'alice' })).toBe(true)
    })

    test('returns matching staged files', async () => {
      const execute = getToolExecutor(makeSearchStagedFilesTool(CTX))
      const result = await execute({ query: 'alice' })
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ senderUsername: 'alice', filename: 'report.pdf' })
    })

    test('searches by filename', async () => {
      const execute = getToolExecutor(makeSearchStagedFilesTool(CTX))
      const result = await execute({ query: 'notes' })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ filename: 'notes.txt' })
    })
  })

  describe('resolve_staged_file', () => {
    test('resolves a staged file into a workspace attachment', async () => {
      const staged = await stageFileMetadata({
        contextId: CTX,
        messageId: 'msg-resolve',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'resolve-me.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_resolve_ok',
        sourceProvider: 'telegram',
      })

      const execute = getToolExecutor(makeResolveStagedFileTool(CTX, mockDownloadFn))
      const result = await execute({ stagedId: staged.stagedId })

      expect(result).toMatchObject({ status: 'resolved', filename: 'resolve-me.pdf' })
      expect(result.attachmentId.startsWith('att_')).toBe(true)
      expect(downloadCalls).toHaveLength(1)
    })

    test('returns error for unknown staged ID', async () => {
      const execute = getToolExecutor(makeResolveStagedFileTool(CTX, mockDownloadFn))
      const result = await execute({ stagedId: 'stg_nonexistent' })
      expect(result).toMatchObject({ status: 'not_found' })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/staged-tools.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/tools/staged-tools.ts`**

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveStagedFile, searchStagedFiles } from '../attachments/staged.js'
import type { StagedFileDownloadFn } from '../attachments/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:staged-files' })

export function makeSearchStagedFilesTool(contextId: string): ToolSet[string] {
  return tool({
    description:
      'Search staged files in the current conversation that have not yet been resolved. Staged files are files sent by any group member that are available to be brought into the workspace. Search by sender username or filename.',
    inputSchema: z.object({
      query: z.string().describe('Search term: sender username or filename substring'),
      limit: z.number().min(1).max(20).optional().describe('Maximum results to return (default: 10)'),
    }),
    execute: ({ query, limit }) => {
      log.debug({ contextId, query, limit }, 'search_staged_files called')
      const results = searchStagedFiles(contextId, query, limit)
      return results.map((ref) => ({
        stagedId: ref.stagedId,
        filename: ref.filename,
        mimeType: ref.mimeType,
        size: ref.size,
        senderUsername: ref.senderUsername,
        createdAt: ref.createdAt,
      }))
    },
  })
}

export function makeResolveStagedFileTool(contextId: string, downloadFn: StagedFileDownloadFn): ToolSet[string] {
  return tool({
    description:
      'Resolve a staged file by downloading it from the chat platform and adding it to the conversation workspace. After resolution, the file can be uploaded to tasks or referenced by its attachment ID.',
    inputSchema: z.object({
      stagedId: z.string().describe('The staged file ID (starts with stg_) to resolve'),
    }),
    execute: async ({ stagedId }) => {
      log.debug({ contextId, stagedId }, 'resolve_staged_file called')
      const result = await resolveStagedFile(stagedId, contextId, downloadFn)

      if ('attachmentId' in result) {
        return { status: 'resolved', attachmentId: result.attachmentId, filename: result.filename }
      }

      return result
    },
  })
}
```

- [ ] **Step 4: Register staged tools in `src/tools/tools-builder.ts`**

Add imports:

```typescript
import { makeResolveStagedFileTool, makeSearchStagedFilesTool } from './staged-tools.js'
import type { StagedFileDownloadFn } from '../attachments/types.js'
```

Add helper function:

```typescript
function addStagedTools(
  tools: ToolSet,
  contextId: string | undefined,
  downloadFn: StagedFileDownloadFn | undefined,
): void {
  if (contextId === undefined) return
  tools['search_staged_files'] = makeSearchStagedFilesTool(contextId)
  if (downloadFn !== undefined) {
    tools['resolve_staged_file'] = makeResolveStagedFileTool(contextId, downloadFn)
  }
}
```

Update `buildTools` signature to accept `stagedDownloadFn`:

```typescript
export function buildTools(
  provider: TaskProvider,
  chatUserId: string | undefined,
  contextId: string | undefined,
  mode: ToolMode,
  contextType?: ContextType,
  username?: string | null,
  stagedDownloadFn?: StagedFileDownloadFn,
): ToolSet {
```

Add call after `addAttachmentTools`:

```typescript
addStagedTools(tools, contextId, stagedDownloadFn)
```

- [ ] **Step 5: Update `src/tools/types.ts`**

Add `stagedDownloadFn` to `MakeToolsOptions`:

```typescript
export type MakeToolsOptions = {
  storageContextId?: string
  chatUserId: string
  username?: string | null
  mode?: ToolMode
  contextType?: ContextType
  stagedDownloadFn?: import('../attachments/types.js').StagedFileDownloadFn
}
```

- [ ] **Step 6: Update `src/tools/index.ts`**

Pass `stagedDownloadFn` through to `buildTools`:

```typescript
const stagedDownloadFn = options === undefined ? undefined : options.stagedDownloadFn
const internalTools = buildTools(provider, chatUserId, contextId, mode, contextType, username, stagedDownloadFn)
```

- [ ] **Step 7: Run tests**

Run: `bun test tests/tools/staged-tools.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/tools/staged-tools.ts src/tools/tools-builder.ts src/tools/types.ts src/tools/index.ts tests/tools/staged-tools.test.ts
git commit -m "feat: add search_staged_files and resolve_staged_file LLM tools"
```

---

### Task 9: Wire Download Fn Through Orchestrator + Startup

**Files:**

- Modify: `src/llm-orchestrator.ts:62-81`
- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/llm-orchestrator.ts`**

Add import:

```typescript
import { getStagedDownloader } from './attachments/staged-download.js'
```

In `getOrCreateTools`, pass the downloader:

```typescript
const stagedDownloadFn = getStagedDownloader() ?? undefined
const tools = makeTools(provider, {
  storageContextId: contextId,
  chatUserId,
  username,
  contextType,
  stagedDownloadFn,
})
```

- [ ] **Step 2: Update `src/index.ts` — initialize staged downloader at startup**

Add imports:

```typescript
import { createStagedDownloader, setStagedDownloader } from './attachments/staged-download.js'
```

Add after `initializeMessageCache()` (after line 58), before `setupBot`:

```typescript
async function initializeStagedDownloader(chat: ChatProvider): Promise<void> {
  if (chat.name === 'telegram') {
    const { getTelegramFileFetcher } = await import('./chat/telegram/index.js')
    const fetcher = getTelegramFileFetcher()
    if (fetcher !== undefined) {
      setStagedDownloader(
        createStagedDownloader({
          telegramFetcher: fetcher,
          mattermostFetcher: async () => null,
        }),
      )
    }
  } else if (chat.name === 'mattermost') {
    const { getMattermostFileFetcher } = await import('./chat/mattermost/index.js')
    const fetcher = getMattermostFileFetcher()
    if (fetcher !== undefined) {
      setStagedDownloader(
        createStagedDownloader({
          telegramFetcher: async () => null,
          mattermostFetcher: fetcher,
        }),
      )
    }
  }
}

await initializeStagedDownloader(chatProvider)
```

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/llm-orchestrator.ts src/index.ts
git commit -m "feat: wire platform-specific staged downloader through orchestrator to tools"
```

---

### Task 10: Background Purge Job

**Files:**

- Modify: `src/scheduler-instance.ts`

- [ ] **Step 1: Register the purge job**

Add import:

```typescript
import { purgeExpiredStagedFiles } from './attachments/staged.js'
```

Add after the existing `message-queue-cleanup` registration:

```typescript
scheduler.register('staged-files-purge', {
  interval: 60 * 60 * 1000,
  handler: purgeExpiredStagedFiles,
  options: { immediate: true },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/scheduler-instance.ts
git commit -m "feat: register hourly staged files purge background job"
```

---

### Task 11: Full Test Suite + Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun lint`
Expected: PASS

- [ ] **Step 4: Run format check**

Run: `bun format:check`
Expected: PASS

- [ ] **Step 5: Run full check suite**

Run: `bun check:full`
Expected: PASS

- [ ] **Step 6: Commit fixes if needed**

```bash
git add -A
git commit -m "chore: fix lint/format issues from staged attachments implementation"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec Requirement                                                      | Task         | Bug Fix                             |
| --------------------------------------------------------------------- | ------------ | ----------------------------------- |
| `staged_files` SQLite table                                           | Task 1       |                                     |
| `staged_id` with `stg_` prefix                                        | Task 3       |                                     |
| Status values (staged/resolved/failed/expired)                        | Task 2, 3    |                                     |
| `stageFileMetadata` — upsert on duplicate                             | Task 3       |                                     |
| `resolveStagedFile` — download + save + mark resolved                 | Task 3       |                                     |
| `searchStagedFiles` — by username/filename                            | Task 3       |                                     |
| `findStagedFilesByMessageId` — for reply enrichment                   | Task 3       |                                     |
| `purgeExpiredStagedFiles` — background cleanup                        | Task 3, 10   |                                     |
| Platform download factory                                             | Task 4       |                                     |
| **Files from ANY user get staged**                                    | Task 5       | Bug 1 fix: staging before auth gate |
| DM keeps existing behavior                                            | Task 5       |                                     |
| Group stages metadata only, no bytes                                  | Task 5, 6, 7 | Bug 3 fix: adapters use candidates  |
| `search_staged_files` tool                                            | Task 8       |                                     |
| `resolve_staged_file` tool                                            | Task 8       |                                     |
| Prompt enrichment for reply-to-staged                                 | Task 5       | Bug 2 fix: uses storageContextId    |
| Background purge job                                                  | Task 10      |                                     |
| Download fn wired through orchestrator                                | Task 9       |                                     |
| Migration 031                                                         | Task 1       |                                     |
| Error handling: expired, download_failed, already_resolved, not_found | Task 3       |                                     |
| Security: only authorized members trigger resolve (tool gating)       | Task 8       |                                     |

### 2. Placeholder Scan

No TBD, TODO, "implement later", or placeholder patterns found.

### 3. Type Consistency

- `StagedFileRef` defined in Task 2, used consistently in Tasks 3, 8
- `StageFileParams` defined in Task 2, used in Tasks 3, 5
- `StagedResolutionError` defined in Task 2, used in Tasks 3, 8
- `StagedFileDownloadFn` defined in Task 2, used in Tasks 4, 8, 9
- `IncomingFileCandidate` defined in Task 2, used in Tasks 5, 6, 7
- `storageContextId` (thread-scoped) used consistently for staging (Task 5) and lookup (Task 5 reply-context)
- Function names consistent: `stageGroupFileCandidates`, `ingestDmAttachments`, `stageFileMetadata`, `resolveStagedFile`, `searchStagedFiles`, `findStagedFilesByMessageId`, `purgeExpiredStagedFiles`
