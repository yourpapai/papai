# File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared attachment pipeline so incoming chat files persist until `/clear`, can be uploaded by tools via stable attachment IDs, and can be sent to multimodal models without polluting conversation history.

**Architecture:** Add a new `src/attachments/` subsystem that becomes the durable source of truth for attachments. Chat adapters keep producing raw `IncomingFile` payloads, bot intake persists them into SQLite metadata plus an S3-compatible bucket and queues stable IDs, prompt/LLM layers use attachment refs plus resolver-controlled hydration, and `/clear` clears attachment state together with history and memory.

**Tech Stack:** TypeScript, Bun, Bun SQLite + Drizzle, Bun's built-in `S3Client` for S3-compatible object storage, Vercel AI SDK v6, existing message queue, existing chat provider capabilities, existing command/test helpers

**S3 configuration (env vars):** `S3_BUCKET` (required), `S3_ACCESS_KEY_ID` (required), `S3_SECRET_ACCESS_KEY` (required), `S3_ENDPOINT` (required for non-AWS providers like MinIO/R2/B2), `S3_REGION` (optional), `S3_PREFIX` (optional), `S3_FORCE_PATH_STYLE` (`'true'` for MinIO).

---

## Scope Check

This stays as one implementation plan. The database, attachment workspace, bot queue, tool wiring, and LLM wiring form a single vertical feature slice; splitting them into separate plans would leave partially-usable behavior behind (for example, persisted attachments with no tool access, or multimodal LLM input with no durable storage).

## File Structure

```text
src/
├── attachments/
│   ├── index.ts                 # Public exports for attachment APIs
│   ├── types.ts                 # AttachmentRef, StoredAttachment, status/input types
│   ├── blob-store.ts            # S3-compatible BlobStore interface + Bun.S3Client backend + DI hooks
│   ├── store.ts                 # SQLite metadata + delegating blob persistence via BlobStore
│   ├── workspace.ts             # Active attachment queries and clear behavior (deletes from S3)
│   ├── ingest.ts                # Convert IncomingFile[] into persisted AttachmentRef[]
│   └── resolver.ts              # Manifest building, model fallback, history placeholders
├── bot.ts                       # Persist attachments before queueing; queue stable IDs
├── commands/clear.ts            # Clear attachment workspace with history + memory
├── db/
│   ├── schema.ts                # attachments table schema
│   ├── index.ts                 # Register migration028 in runtime order
│   └── migrations/
│       └── 028_attachment_workspace.ts
├── llm-orchestrator.ts          # Accept structured turn input and hydrate multipart content
├── llm-orchestrator-types.ts    # ProcessMessageInput type
├── message-queue/
│   ├── types.ts                 # QueueItem carries newAttachmentIds, not raw files
│   └── queue.ts                 # Coalesce stable attachment IDs
├── reply-context.ts             # Render attachment manifest using papai attachment IDs
├── tools/upload-attachment.ts   # Resolve workspace attachmentId instead of transient fileId
└── file-relay.ts                # Delete after upload_attachment stops using it

tests/
├── attachments/
│   ├── blob-store.test.ts       # In-memory BlobStore behavior and DI
│   ├── store.test.ts            # Durable store behavior with injected in-memory blob store
│   ├── workspace.test.ts        # Persist/list/clear active attachment behavior, S3 deletion
│   └── resolver.test.ts         # Manifest building and model/tool fallback
├── bot.test.ts                  # Bot intake persists attachments and forwards IDs
├── commands/
│   └── clear.test.ts            # /clear clears attachment workspace
├── db/
│   ├── migrations/
│   │   └── 028_attachment_workspace.test.ts
│   └── schema.test.ts           # attachments table is exposed through Drizzle schema
├── llm-orchestrator.test.ts     # Multipart model input + history placeholder behavior
├── message-queue/
│   ├── types.test.ts
│   ├── queue.test.ts
│   └── index.integration.test.ts
├── reply-context.test.ts        # Manifest prompt text uses attachmentId refs
└── tools/
    └── attachment-tools.test.ts # upload_attachment uses workspace attachment IDs
```

> **Note on Discord:** an earlier draft of this plan included a Task 8 that removed `files.receive` from Discord capabilities. That capability is already absent from `src/chat/discord/metadata.ts`, so the original Task 8 has been dropped — the plan ends at Task 7.

**Testing note:** new mirrored `tests/attachments/*.test.ts`, existing `tests/message-queue/*.test.ts`, and `tests/commands/clear.test.ts` must be run explicitly with `bun test <path>` because the default `bun test` script does not include those directories today.

---

### Task 1: Add the attachment workspace migration and schema

**Files:**

- Create: `src/db/migrations/028_attachment_workspace.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema.ts`
- Test: `tests/db/migrations/028_attachment_workspace.test.ts`
- Test: `tests/db/schema.test.ts`

> Note: migration 020 already exists (`020_group_settings_registry`); the latest applied migration is 027 (`027_scheduled_prompt_timezone`). The new migration is therefore 028. `tests/utils/test-helpers.ts` re-exports `MIGRATIONS` from `src/db/index.ts`, so adding the migration to the runtime list automatically wires it into the test DB — no edit to `test-helpers.ts` is required.

- [ ] **Step 1: Write the failing migration and schema tests**

```typescript
// tests/db/migrations/028_attachment_workspace.test.ts
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration028AttachmentWorkspace } from '../../../src/db/migrations/028_attachment_workspace.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

describe('migration028AttachmentWorkspace', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates attachments table and active-state indexes', () => {
    migration028AttachmentWorkspace.up(db)

    expect(getNames(db, 'table')).toContain('attachments')
    expect(getNames(db, 'index')).toContain('idx_attachments_context_active')
    expect(getNames(db, 'index')).toContain('idx_attachments_context_checksum')
  })
})

// tests/db/schema.test.ts
import { describe, expect, it, beforeEach } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachments schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('exposes the attachments table through Drizzle', () => {
    const db = getDrizzleDb()
    expect(db).toBeDefined()
    expect(attachments.attachmentId).toBeDefined()
    expect(attachments.contextId).toBeDefined()
    expect(attachments.isActive).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the DB tests to verify they fail**

Run: `bun test tests/db/migrations/028_attachment_workspace.test.ts tests/db/schema.test.ts`
Expected: FAIL with `Cannot find module '../../../src/db/migrations/028_attachment_workspace.js'` and/or missing `attachments` export from `src/db/schema.ts`

- [ ] **Step 3: Add migration028, register it in the runtime migrations array, and expose the schema**

The `attachments` row stores an S3 object key (`blob_key`), not a filesystem path. Bytes themselves live in the configured S3-compatible bucket (see `src/attachments/blob-store.ts` in Task 2).

```typescript
// src/db/migrations/028_attachment_workspace.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration028AttachmentWorkspace: Migration = {
  id: '028_attachment_workspace',
  up(db: Database): void {
    db.run(`
      CREATE TABLE attachments (
        attachment_id     TEXT PRIMARY KEY,
        context_id        TEXT NOT NULL,
        source_provider   TEXT NOT NULL,
        source_message_id TEXT,
        source_file_id    TEXT,
        filename          TEXT NOT NULL,
        mime_type         TEXT,
        size              INTEGER,
        checksum          TEXT NOT NULL,
        blob_key          TEXT NOT NULL,
        status            TEXT NOT NULL,
        is_active         INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        cleared_at        TEXT,
        last_used_at      TEXT
      )
    `)
    db.run(`CREATE INDEX idx_attachments_context_active ON attachments(context_id, is_active, created_at)`)
    db.run(`CREATE INDEX idx_attachments_context_checksum ON attachments(context_id, checksum)`)
  },
}

// src/db/index.ts — append to imports + MIGRATIONS list
import { migration028AttachmentWorkspace } from './migrations/028_attachment_workspace.js'
// ...
export const MIGRATIONS: readonly Migration[] = [
  // ...existing 001..027 entries
  migration027ScheduledPromptTimezone,
  migration028AttachmentWorkspace,
]

// src/db/schema.ts
export const attachments = sqliteTable(
  'attachments',
  {
    attachmentId: text('attachment_id').primaryKey(),
    contextId: text('context_id').notNull(),
    sourceProvider: text('source_provider').notNull(),
    sourceMessageId: text('source_message_id'),
    sourceFileId: text('source_file_id'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    checksum: text('checksum').notNull(),
    blobKey: text('blob_key').notNull(),
    status: text('status').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    clearedAt: text('cleared_at'),
    lastUsedAt: text('last_used_at'),
  },
  (table) => [
    index('idx_attachments_context_active').on(table.contextId, table.isActive, table.createdAt),
    index('idx_attachments_context_checksum').on(table.contextId, table.checksum),
  ],
)

export type AttachmentRow = typeof attachments.$inferSelect
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `bun test tests/db/migrations/028_attachment_workspace.test.ts tests/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/028_attachment_workspace.ts src/db/index.ts src/db/schema.ts tests/db/migrations/028_attachment_workspace.test.ts tests/db/schema.test.ts
git commit -m "feat(attachments): add attachment workspace schema"
```

---

### Task 2: Implement the BlobStore abstraction and the durable attachment store

**Files:**

- Create: `src/attachments/types.ts`
- Create: `src/attachments/blob-store.ts`
- Create: `src/attachments/store.ts`
- Create: `src/attachments/index.ts`
- Test: `tests/attachments/blob-store.test.ts`
- Test: `tests/attachments/store.test.ts`

- [ ] **Step 1: Write the failing blob-store and store tests**

```typescript
// tests/attachments/blob-store.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createInMemoryBlobStore,
  getBlobStore,
  resetBlobStore,
  setBlobStore,
} from '../../src/attachments/blob-store.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('blob-store DI', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    resetBlobStore()
  })

  test('round-trips bytes through the in-memory store and supports delete', async () => {
    const store = createInMemoryBlobStore()
    setBlobStore(store)

    await getBlobStore().put('ctx/key-1', Buffer.from('hello'), 'text/plain')
    expect((await getBlobStore().get('ctx/key-1')).toString('utf8')).toBe('hello')

    await getBlobStore().delete('ctx/key-1')
    await expect(getBlobStore().get('ctx/key-1')).rejects.toThrow()
  })
})

// tests/attachments/store.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createInMemoryBlobStore,
  resetBlobStore,
  setBlobStore,
  type InMemoryBlobStore,
} from '../../src/attachments/blob-store.js'
import { loadAttachmentRecord, saveAttachment } from '../../src/attachments/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachment store', () => {
  let blobs: InMemoryBlobStore

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    blobs = createInMemoryBlobStore()
    setBlobStore(blobs)
  })

  afterEach(() => {
    resetBlobStore()
  })

  test('persists metadata in SQLite and bytes in the configured blob store', async () => {
    const ref = await saveAttachment({
      contextId: 'ctx-store',
      sourceProvider: 'telegram',
      sourceMessageId: 'm-1',
      sourceFileId: 'f-1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4,
      status: 'available',
      content: Buffer.from('data'),
    })

    const record = await loadAttachmentRecord('ctx-store', ref.attachmentId)

    expect(record).not.toBeNull()
    expect(record?.filename).toBe('report.pdf')
    expect(record?.content.toString('utf8')).toBe('data')
    expect(blobs.has(record?.blobKey ?? '')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the store and blob-store tests to verify they fail**

Run: `bun test tests/attachments/blob-store.test.ts tests/attachments/store.test.ts`
Expected: FAIL with `Cannot find module '../../src/attachments/blob-store.js'` and/or `Cannot find module '../../src/attachments/store.js'`

- [ ] **Step 3: Create attachment types, the BlobStore abstraction (with Bun.S3Client backend + in-memory test impl), and the metadata-aware store**

```typescript
// src/attachments/types.ts
export type AttachmentStatus = 'available' | 'tool_only' | 'rejected' | 'unavailable'

export type AttachmentSourceProvider = 'telegram' | 'mattermost' | 'discord' | 'unknown'

export type AttachmentRef = {
  attachmentId: string
  contextId: string
  filename: string
  mimeType?: string
  size?: number
  status: AttachmentStatus
}

export type StoredAttachment = AttachmentRef & {
  sourceProvider: AttachmentSourceProvider
  sourceMessageId?: string
  sourceFileId?: string
  checksum: string
  blobKey: string
  createdAt: string
  clearedAt?: string | null
  lastUsedAt?: string | null
  content: Buffer
}

export type SaveAttachmentInput = {
  contextId: string
  sourceProvider: AttachmentSourceProvider
  sourceMessageId?: string
  sourceFileId?: string
  filename: string
  mimeType?: string
  size?: number
  status: AttachmentStatus
  content: Buffer
}

// src/attachments/blob-store.ts
import { S3Client } from 'bun'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'attachments:blob-store' })

export interface BlobStore {
  put(key: string, content: Buffer, contentType?: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  deleteMany(keys: readonly string[]): Promise<void>
}

/** Test-only in-memory implementation. */
export interface InMemoryBlobStore extends BlobStore {
  has(key: string): boolean
  size(): number
}

export function createInMemoryBlobStore(): InMemoryBlobStore {
  const map = new Map<string, Buffer>()
  return {
    async put(key, content) {
      map.set(key, Buffer.from(content))
    },
    async get(key) {
      const value = map.get(key)
      if (value === undefined) throw new Error(`InMemoryBlobStore: key not found: ${key}`)
      return Buffer.from(value)
    },
    async delete(key) {
      map.delete(key)
    },
    async deleteMany(keys) {
      for (const key of keys) map.delete(key)
    },
    has: (key) => map.has(key),
    size: () => map.size,
  }
}

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required S3 env var: ${name}`)
  }
  return value
}

const buildS3Client = (): S3Client => {
  const bucket = requireEnv('S3_BUCKET')
  const accessKeyId = requireEnv('S3_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv('S3_SECRET_ACCESS_KEY')
  const endpoint = process.env['S3_ENDPOINT']
  const region = process.env['S3_REGION']
  const virtualHostedStyle = process.env['S3_FORCE_PATH_STYLE'] !== 'true'
  return new S3Client({
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    virtualHostedStyle,
  })
}

export function createS3BlobStore(): BlobStore {
  const client = buildS3Client()
  return {
    async put(key, content, contentType) {
      const file = client.file(key)
      await file.write(content, contentType !== undefined ? { type: contentType } : undefined)
    },
    async get(key) {
      const file = client.file(key)
      const arrayBuffer = await file.arrayBuffer()
      return Buffer.from(arrayBuffer)
    },
    async delete(key) {
      try {
        await client.file(key).delete()
      } catch (error) {
        log.warn(
          { key, error: error instanceof Error ? error.message : String(error) },
          'Blob delete failed, continuing',
        )
      }
    },
    async deleteMany(keys) {
      for (const key of keys) {
        try {
          await client.file(key).delete()
        } catch (error) {
          log.warn(
            { key, error: error instanceof Error ? error.message : String(error) },
            'Blob delete failed, continuing',
          )
        }
      }
    },
  }
}

let active: BlobStore | null = null

export function getBlobStore(): BlobStore {
  if (active === null) active = createS3BlobStore()
  return active
}

/** Test/DI hook: install a custom blob store. */
export function setBlobStore(store: BlobStore): void {
  active = store
}

/** Test/DI hook: clear the cached blob store and force re-creation on next access. */
export function resetBlobStore(): void {
  active = null
}

export function buildBlobKey(contextId: string, attachmentId: string): string {
  const prefix = process.env['S3_PREFIX'] ?? ''
  const head = prefix === '' ? '' : `${prefix.replace(/\/+$/, '')}/`
  return `${head}${contextId}/${attachmentId}`
}

// src/attachments/store.ts
import { createHash, randomUUID } from 'node:crypto'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import { buildBlobKey, getBlobStore } from './blob-store.js'
import type { AttachmentRef, SaveAttachmentInput, StoredAttachment } from './types.js'

const log = logger.child({ scope: 'attachments:store' })

export async function saveAttachment(input: SaveAttachmentInput): Promise<AttachmentRef> {
  const attachmentId = `att_${randomUUID()}`
  const createdAt = new Date().toISOString()
  const checksum = createHash('sha256').update(input.content).digest('hex')
  const blobKey = buildBlobKey(input.contextId, attachmentId)

  await getBlobStore().put(blobKey, input.content, input.mimeType)

  getDrizzleDb()
    .insert(attachments)
    .values({
      attachmentId,
      contextId: input.contextId,
      sourceProvider: input.sourceProvider,
      sourceMessageId: input.sourceMessageId,
      sourceFileId: input.sourceFileId,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      checksum,
      blobKey,
      status: input.status,
      isActive: 1,
      createdAt,
      clearedAt: null,
      lastUsedAt: null,
    })
    .run()

  log.info({ attachmentId, contextId: input.contextId, filename: input.filename, blobKey }, 'Attachment stored')

  return {
    attachmentId,
    contextId: input.contextId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
    status: input.status,
  }
}

export async function loadAttachmentRecord(contextId: string, attachmentId: string): Promise<StoredAttachment | null> {
  const row = getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.contextId, contextId), eq(attachments.attachmentId, attachmentId)))
    .get()

  if (row === undefined || row.clearedAt !== null) return null

  const content = await getBlobStore().get(row.blobKey)

  return {
    attachmentId: row.attachmentId,
    contextId: row.contextId,
    filename: row.filename,
    mimeType: row.mimeType ?? undefined,
    size: row.size ?? undefined,
    status: row.status as StoredAttachment['status'],
    sourceProvider: row.sourceProvider as StoredAttachment['sourceProvider'],
    sourceMessageId: row.sourceMessageId ?? undefined,
    sourceFileId: row.sourceFileId ?? undefined,
    checksum: row.checksum,
    blobKey: row.blobKey,
    createdAt: row.createdAt,
    clearedAt: row.clearedAt,
    lastUsedAt: row.lastUsedAt,
    content,
  }
}

// src/attachments/index.ts
export type {
  AttachmentRef,
  AttachmentStatus,
  AttachmentSourceProvider,
  SaveAttachmentInput,
  StoredAttachment,
} from './types.js'
export { loadAttachmentRecord, saveAttachment } from './store.js'
export {
  createInMemoryBlobStore,
  createS3BlobStore,
  getBlobStore,
  resetBlobStore,
  setBlobStore,
  type BlobStore,
  type InMemoryBlobStore,
} from './blob-store.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/attachments/blob-store.test.ts tests/attachments/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/types.ts src/attachments/blob-store.ts src/attachments/store.ts src/attachments/index.ts tests/attachments/blob-store.test.ts tests/attachments/store.test.ts
git commit -m "feat(attachments): add S3-backed blob store and durable attachment store"
```

---

### Task 3: Implement workspace queries, clear behavior, and ingest

**Files:**

- Create: `src/attachments/workspace.ts`
- Create: `src/attachments/ingest.ts`
- Modify: `src/attachments/index.ts`
- Test: `tests/attachments/workspace.test.ts`

- [ ] **Step 1: Write the failing workspace/ingest test**

```typescript
// tests/attachments/workspace.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createInMemoryBlobStore,
  resetBlobStore,
  setBlobStore,
  type InMemoryBlobStore,
} from '../../src/attachments/blob-store.js'
import { persistIncomingAttachments } from '../../src/attachments/ingest.js'
import { clearAttachmentWorkspace, listActiveAttachments } from '../../src/attachments/workspace.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachment workspace', () => {
  let blobs: InMemoryBlobStore

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    blobs = createInMemoryBlobStore()
    setBlobStore(blobs)
  })

  afterEach(() => {
    resetBlobStore()
  })

  test('persists incoming files, lists them as active, and clears them by context', async () => {
    const refs = await persistIncomingAttachments({
      contextId: 'ctx-workspace',
      sourceProvider: 'mattermost',
      sourceMessageId: 'm-42',
      files: [
        {
          fileId: 'platform-f1',
          filename: 'diagram.png',
          mimeType: 'image/png',
          size: 7,
          content: Buffer.from('pngdata'),
        },
      ],
    })

    expect(refs).toHaveLength(1)
    expect(refs[0]?.attachmentId.startsWith('att_')).toBe(true)
    expect(listActiveAttachments('ctx-workspace')).toHaveLength(1)
    expect(blobs.size()).toBe(1)

    await clearAttachmentWorkspace('ctx-workspace')

    expect(listActiveAttachments('ctx-workspace')).toEqual([])
    expect(blobs.size()).toBe(0)
  })
})
```

- [ ] **Step 2: Run the workspace test to verify it fails**

Run: `bun test tests/attachments/workspace.test.ts`
Expected: FAIL with `Cannot find module '../../src/attachments/workspace.js'` and/or `Cannot find module '../../src/attachments/ingest.js'`

- [ ] **Step 3: Add workspace and ingest helpers (delete blobs through `BlobStore`)**

```typescript
// src/attachments/workspace.ts
import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import { getBlobStore } from './blob-store.js'
import type { AttachmentRef } from './types.js'

const log = logger.child({ scope: 'attachments:workspace' })

export function listActiveAttachments(contextId: string): AttachmentRef[] {
  return getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.contextId, contextId), eq(attachments.isActive, 1)))
    .all()
    .filter((row) => row.clearedAt === null)
    .map((row) => ({
      attachmentId: row.attachmentId,
      contextId: row.contextId,
      filename: row.filename,
      mimeType: row.mimeType ?? undefined,
      size: row.size ?? undefined,
      status: row.status as AttachmentRef['status'],
    }))
}

export async function clearAttachmentWorkspace(contextId: string): Promise<void> {
  const rows = getDrizzleDb()
    .select({ blobKey: attachments.blobKey })
    .from(attachments)
    .where(eq(attachments.contextId, contextId))
    .all()

  if (rows.length > 0) {
    await getBlobStore().deleteMany(rows.map((row) => row.blobKey))
  }

  getDrizzleDb().delete(attachments).where(eq(attachments.contextId, contextId)).run()
  log.info({ contextId, count: rows.length }, 'Attachment workspace cleared')
}

// src/attachments/ingest.ts
import type { IncomingFile } from '../chat/types.js'
import { saveAttachment } from './store.js'
import type { AttachmentRef, AttachmentSourceProvider } from './types.js'

export async function persistIncomingAttachments(params: {
  contextId: string
  sourceProvider: AttachmentSourceProvider
  sourceMessageId?: string
  files: readonly IncomingFile[]
}): Promise<AttachmentRef[]> {
  const refs: AttachmentRef[] = []
  for (const file of params.files) {
    refs.push(
      await saveAttachment({
        contextId: params.contextId,
        sourceProvider: params.sourceProvider,
        sourceMessageId: params.sourceMessageId,
        sourceFileId: file.fileId,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        status: 'available',
        content: file.content,
      }),
    )
  }
  return refs
}

// src/attachments/index.ts (extend)
export { persistIncomingAttachments } from './ingest.js'
export { clearAttachmentWorkspace, listActiveAttachments } from './workspace.js'
```

- [ ] **Step 4: Run the workspace test to verify it passes**

Run: `bun test tests/attachments/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/workspace.ts src/attachments/ingest.ts src/attachments/index.ts tests/attachments/workspace.test.ts
git commit -m "feat(attachments): add workspace ingest and clear helpers"
```

---

### Task 4: Add resolver rules and stable attachment manifests

**Files:**

- Create: `src/attachments/resolver.ts`
- Modify: `src/attachments/index.ts`
- Modify: `src/reply-context.ts`
- Test: `tests/attachments/resolver.test.ts`
- Modify: `tests/reply-context.test.ts`

- [ ] **Step 1: Write the failing resolver and prompt tests**

```typescript
// tests/attachments/resolver.test.ts
import { describe, expect, test } from 'bun:test'

import type { AttachmentRef } from '../../src/attachments/types.js'
import { buildAttachmentManifest, selectAttachmentsForTurn } from '../../src/attachments/resolver.js'

const refs: AttachmentRef[] = [
  {
    attachmentId: 'att_123',
    contextId: 'ctx',
    filename: 'design.pdf',
    mimeType: 'application/pdf',
    size: 12,
    status: 'available',
  },
  {
    attachmentId: 'att_456',
    contextId: 'ctx',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 34,
    status: 'available',
  },
]

describe('attachment resolver', () => {
  test('builds a stable manifest using papai attachment ids', () => {
    expect(buildAttachmentManifest(refs)).toBe(
      '[Available attachments: att_123 design.pdf (application/pdf, 12 bytes); att_456 photo.jpg (image/jpeg, 34 bytes)]',
    )
  })

  test('uses new attachments by default and only explicit ids for old attachments', () => {
    const selected = selectAttachmentsForTurn({
      text: 'Please compare att_456 with the new upload',
      newAttachmentIds: ['att_123'],
      activeAttachments: refs,
    })

    expect(selected.map((ref) => ref.attachmentId)).toEqual(['att_123', 'att_456'])
  })
})

// tests/reply-context.test.ts
test('renders stable attachment ids instead of platform fileId metadata', () => {
  const msg = makeDmMessage({ text: 'Please review this' })
  const result = buildPromptWithReplyContext(msg, [
    {
      attachmentId: 'att_123',
      contextId: 'ctx1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 12345,
      status: 'available',
    },
  ])

  expect(result).toContain('att_123 report.pdf (application/pdf, 12345 bytes)')
  expect(result).not.toContain('fileId=')
})
```

- [ ] **Step 2: Run the resolver/prompt tests to verify they fail**

Run: `bun test tests/attachments/resolver.test.ts tests/reply-context.test.ts`
Expected: FAIL with `Cannot find module '../../src/attachments/resolver.js'` and/or wrong `buildPromptWithReplyContext()` signature

- [ ] **Step 3: Implement resolver helpers and update the prompt builder signature**

```typescript
// src/attachments/resolver.ts
import type { AttachmentRef } from './types.js'

const MULTIMODAL_MODEL_PREFIXES = ['gpt-4o', 'gpt-4.1', 'claude-3', 'claude-sonnet-4', 'claude-opus-4']

export function supportsAttachmentModelInput(modelName: string): boolean {
  return MULTIMODAL_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix))
}

export function buildAttachmentManifest(attachments: readonly AttachmentRef[]): string | null {
  if (attachments.length === 0) return null
  const rendered = attachments
    .map((attachment) => {
      const meta: string[] = []
      if (attachment.mimeType !== undefined) meta.push(attachment.mimeType)
      if (attachment.size !== undefined) meta.push(`${attachment.size} bytes`)
      const suffix = meta.length > 0 ? ` (${meta.join(', ')})` : ''
      return `${attachment.attachmentId} ${attachment.filename}${suffix}`
    })
    .join('; ')
  return `[Available attachments: ${rendered}]`
}

export function selectAttachmentsForTurn(params: {
  text: string
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}): AttachmentRef[] {
  const mentionedIds = new Set(Array.from(params.text.matchAll(/\batt_[a-z0-9-]+\b/gi), (match) => match[0]))
  const selectedIds = new Set([...params.newAttachmentIds, ...mentionedIds])
  return params.activeAttachments.filter((attachment) => selectedIds.has(attachment.attachmentId))
}

export function buildHistoryAttachmentLines(attachments: readonly AttachmentRef[]): string[] {
  return attachments.map((attachment) => `[User attached ${attachment.attachmentId}: ${attachment.filename}]`)
}

// src/attachments/index.ts
export {
  buildAttachmentManifest,
  buildHistoryAttachmentLines,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './resolver.js'

// src/reply-context.ts
import type { AttachmentRef } from './attachments/types.js'
import { buildAttachmentManifest } from './attachments/index.js'

export function buildPromptWithReplyContext(msg: IncomingMessage, attachments: readonly AttachmentRef[] = []): string {
  const hasReplyContext = msg.replyContext !== undefined
  const manifest = buildAttachmentManifest(attachments)

  if (!hasReplyContext && manifest === null) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext !== undefined) {
    if (msg.replyContext.text !== undefined) {
      const author = msg.replyContext.authorUsername ?? 'user'
      context.push(`[Replying to message from ${author}: "${msg.replyContext.text}"]`)
    }
    if (msg.replyContext.quotedText !== undefined) {
      context.push(`[Quoted text: "${msg.replyContext.quotedText}"]`)
    }
    if (msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== '') {
      context.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
    }
  }

  if (manifest !== null) context.push(manifest)

  return context.join('\n') + '\n\n' + msg.text
}
```

- [ ] **Step 4: Run the resolver/prompt tests to verify they pass**

Run: `bun test tests/attachments/resolver.test.ts tests/reply-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/resolver.ts src/attachments/index.ts src/reply-context.ts tests/attachments/resolver.test.ts tests/reply-context.test.ts
git commit -m "feat(attachments): add resolver and prompt manifest" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Persist attachments in bot intake and queue stable IDs

**Files:**

- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/message-queue/types.ts`
- Modify: `src/message-queue/queue.ts`
- Modify: `src/bot.ts`
- Modify: `tests/message-queue/types.test.ts`
- Modify: `tests/message-queue/queue.test.ts`
- Modify: `tests/message-queue/index.integration.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing queue/bot tests for attachment IDs**

```typescript
// tests/message-queue/types.test.ts
test('QueueItem carries newAttachmentIds instead of raw files', () => {
  const item: QueueItem = {
    text: 'Hello',
    userId: '123',
    username: 'alice',
    storageContextId: '456',
    contextType: 'dm',
    newAttachmentIds: ['att_123'],
  }
  expect(item.newAttachmentIds).toEqual(['att_123'])
})

// tests/message-queue/queue.test.ts
it('accumulates newAttachmentIds from all messages', () => {
  queue.enqueue(
    {
      text: 'First',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      newAttachmentIds: ['att_1'],
    },
    mockReply,
  )
  queue.enqueue(
    {
      text: 'Second',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      newAttachmentIds: ['att_2'],
    },
    mockReply,
  )

  const flushed = queue.forceFlush()
  expect(flushed?.newAttachmentIds).toEqual(['att_1', 'att_2'])
})

// tests/bot.test.ts
import { listActiveAttachments } from '../src/attachments/index.js'
import type { ProcessMessageInput } from '../src/llm-orchestrator-types.js'

test('persists incoming files before processing and forwards stable ids', async () => {
  addUser('relay-user', RELAY_ADMIN)
  setupUserConfig('relay-user')

  let forwardedInput: ProcessMessageInput | null = null
  const botDeps: BotDeps = {
    processMessage: (_reply, _storageContextId, _username, input): Promise<void> => {
      forwardedInput = input
      return Promise.resolve()
    },
  }

  const file = makeFile()
  const msg: IncomingMessage = { ...createDmMessage('relay-user'), files: [file] }
  const { reply } = createMockReply()

  await getMessageHandler()!(msg, reply)

  expect(forwardedInput?.newAttachmentIds).toHaveLength(1)
  expect(listActiveAttachments('relay-user')).toHaveLength(1)
})
```

- [ ] **Step 2: Run the queue/bot tests to verify they fail**

Run: `bun test tests/message-queue/types.test.ts tests/message-queue/queue.test.ts tests/message-queue/index.integration.test.ts tests/bot.test.ts`
Expected: FAIL with type errors about missing `newAttachmentIds` and/or `processMessage` argument shape mismatch

- [ ] **Step 3: Change the bot and queue to carry stable attachment IDs**

```typescript
// src/llm-orchestrator-types.ts
export type ProcessMessageInput = {
  text: string
  newAttachmentIds: readonly string[]
}

// src/message-queue/types.ts
export interface QueueItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly contextType: 'dm' | 'group'
  readonly newAttachmentIds: readonly string[]
}

export interface CoalescedItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly newAttachmentIds: readonly string[]
  readonly reply: ReplyFn
}

// src/message-queue/queue.ts
const allAttachmentIds: string[] = []

for (const msg of this.messages) {
  if (isThread && msg.item.username !== null) {
    texts.push(`[@${msg.item.username}]: ${msg.item.text}`)
  } else {
    texts.push(msg.item.text)
  }
  allAttachmentIds.push(...msg.item.newAttachmentIds)
}

const result: CoalescedItem = {
  text,
  userId: firstMessage.item.userId,
  username: firstMessage.item.username,
  storageContextId: this.storageContextId,
  newAttachmentIds: allAttachmentIds,
  reply,
}

// src/bot.ts (relevant excerpt — preserve all surrounding existing wiring)
import { listActiveAttachments, persistIncomingAttachments } from './attachments/index.js'

// handleMessage already exists; persist attachments before enqueueing
async function handleMessage(
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

  const newAttachmentRefs = await persistIncomingAttachments({
    contextId: auth.storageContextId,
    sourceProvider: 'unknown', // TODO: thread chat.name through if available
    sourceMessageId: msg.messageId,
    files: msg.files ?? [],
  })
  const activeAttachments = listActiveAttachments(auth.storageContextId)

  enqueueMessage(
    {
      text: buildPromptWithReplyContext(msg, activeAttachments),
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      newAttachmentIds: newAttachmentRefs.map((ref) => ref.attachmentId),
    },
    reply,
    (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
  )
}
```

- [ ] **Step 4: Run the queue/bot tests to verify they pass**

Run: `bun test tests/message-queue/types.test.ts tests/message-queue/queue.test.ts tests/message-queue/index.integration.test.ts tests/bot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-types.ts src/message-queue/types.ts src/message-queue/queue.ts src/bot.ts tests/message-queue/types.test.ts tests/message-queue/queue.test.ts tests/message-queue/index.integration.test.ts tests/bot.test.ts
git commit -m "refactor(bot): queue attachment ids instead of raw files" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Move tools and `/clear` off the transient relay, then delete it

**Files:**

- Modify: `src/tools/upload-attachment.ts`
- Modify: `src/commands/clear.ts`
- Delete: `src/file-relay.ts`
- Modify: `tests/tools/attachment-tools.test.ts`
- Create: `tests/commands/clear.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing upload and clear tests**

```typescript
// tests/tools/attachment-tools.test.ts
import { listActiveAttachments, persistIncomingAttachments } from '../../src/attachments/index.js'
import { setupTestDb } from '../utils/test-helpers.js'

test('uploads file when attachmentId is found in the workspace', async () => {
  await setupTestDb()
  persistIncomingAttachments({
    contextId: CTX,
    sourceProvider: 'telegram',
    files: [{ fileId: 'platform-1', filename: 'photo.jpg', mimeType: 'image/jpeg', content: Buffer.from('img') }],
  })

  const uploadAttachment = mock(() =>
    Promise.resolve({ id: 'att-99', name: 'photo.jpg', url: 'https://example.com/photo.jpg' }),
  )
  const provider = createMockProvider({ uploadAttachment })
  const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
  const active = listActiveAttachments(CTX)

  const result = await execute({ taskId: 'task-1', attachmentId: active[0]!.attachmentId })

  expect(result).toEqual({ id: 'att-99', name: 'photo.jpg', url: 'https://example.com/photo.jpg' })
})

// tests/commands/clear.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { persistIncomingAttachments, listActiveAttachments } from '../../src/attachments/index.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import {
  createMockChatWithCommandHandlers,
  createMockReply,
  createDmMessage,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/clear Command', () => {
  let clearHandler: CommandHandler | null = null

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerClearCommand(mockChat, () => true, 'admin-user')
    clearHandler = commandHandlers.get('clear') ?? null
  })

  test('clears attachment workspace together with history and memory', async () => {
    persistIncomingAttachments({
      contextId: 'clear-user',
      sourceProvider: 'telegram',
      files: [{ fileId: 'f1', filename: 'note.txt', content: Buffer.from('note') }],
    })

    const { reply, textCalls } = createMockReply()
    await clearHandler!(createDmMessage('clear-user', '/clear'), reply, {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'clear-user',
    })

    expect(listActiveAttachments('clear-user')).toEqual([])
    expect(textCalls[0]).toContain('attachments')
  })
})
```

- [ ] **Step 2: Run the upload and clear tests to verify they fail**

Run: `bun test tests/tools/attachment-tools.test.ts tests/commands/clear.test.ts tests/bot.test.ts`
Expected: FAIL because `makeUploadAttachmentTool` still expects `fileId`, `/clear` does not touch attachments, and `bot.test.ts` still contains relay-specific assertions

- [ ] **Step 3: Switch to workspace lookups, update `/clear`, and delete `file-relay.ts`**

```typescript
// src/tools/upload-attachment.ts
import { loadAttachmentRecord } from '../attachments/index.js'

export type UploadAttachmentStatus =
  | { status: 'attachment_not_found'; message: string }
  | { status: 'attachment_unavailable'; message: string }

async function executeUpload(
  provider: TaskProvider,
  contextId: string,
  taskId: string,
  attachmentId: string,
): Promise<unknown> {
  const record = await loadAttachmentRecord(contextId, attachmentId)

  if (record === null) {
    return {
      status: 'attachment_not_found',
      message: `Attachment "${attachmentId}" is not available in this context.`,
    } satisfies UploadAttachmentStatus
  }

  const result = await provider.uploadAttachment!(taskId, {
    name: record.filename,
    content: record.content,
    mimeType: record.mimeType,
  })
  return result
}

inputSchema: z.object({
  taskId: z.string().describe('Task ID to attach the file to'),
  attachmentId: z.string().describe('Stable papai attachment ID from the current context'),
})

execute: async ({ taskId, attachmentId }) => executeUpload(provider, contextId, taskId, attachmentId)

// src/commands/clear.ts
import { clearAttachmentWorkspace } from '../attachments/index.js'

async function clearSelf(msg: { user: { id: string } }, reply: ReplyFn, auth: AuthorizationResult): Promise<boolean> {
  clearHistory(auth.storageContextId)
  clearSummary(auth.storageContextId)
  clearFacts(auth.storageContextId)
  await clearAttachmentWorkspace(auth.storageContextId)
  await reply.text('Conversation history, memory, and attachments cleared.')
  return true
}

async function clearAll(msg: { user: { id: string } }, reply: ReplyFn): Promise<boolean> {
  const users = listUsers()
  for (const user of users) {
    clearHistory(user.platform_user_id)
    clearSummary(user.platform_user_id)
    clearFacts(user.platform_user_id)
    await clearAttachmentWorkspace(user.platform_user_id)
  }
  await reply.text(`Cleared history, memory, and attachments for all ${users.length} users.`)
  return true
}

async function clearUser(msg: { user: { id: string } }, reply: ReplyFn, targetId: string): Promise<boolean> {
  clearHistory(targetId)
  clearSummary(targetId)
  clearFacts(targetId)
  await clearAttachmentWorkspace(targetId)
  await reply.text(`Cleared history, memory, and attachments for user ${targetId}.`)
  return true
}

// delete src/file-relay.ts
```

- [ ] **Step 4: Run the upload and clear tests to verify they pass**

Run: `bun test tests/tools/attachment-tools.test.ts tests/commands/clear.test.ts tests/bot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/upload-attachment.ts src/commands/clear.ts tests/tools/attachment-tools.test.ts tests/commands/clear.test.ts tests/bot.test.ts
git rm src/file-relay.ts
git commit -m "refactor(attachments): replace file relay with workspace lookups" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Send multimodal attachment input to the LLM while keeping history text-safe

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Modify: `src/llm-orchestrator-types.ts`
- Modify: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Write the failing LLM test**

```typescript
// tests/llm-orchestrator.test.ts
import { persistIncomingAttachments } from '../src/attachments/index.js'
import type { ProcessMessageInput } from '../src/llm-orchestrator-types.js'

test('sends image parts to supported models but stores placeholder text in history', async () => {
  const attachmentCtx = 'attachment-ctx'
  seedConfigForContext(attachmentCtx)
  setCachedConfig(attachmentCtx, 'main_model', 'gpt-4o')

  const refs = persistIncomingAttachments({
    contextId: attachmentCtx,
    sourceProvider: 'telegram',
    files: [{ fileId: 'f1', filename: 'photo.jpg', mimeType: 'image/jpeg', content: Buffer.from('img') }],
  })

  let capturedMessages: unknown[] = []
  generateTextImpl = (args): Promise<GenerateTextResult> => {
    capturedMessages = args?.messages ?? []
    return defaultGenerateTextResult()
  }

  const { reply } = createMockReply()
  const input: ProcessMessageInput = {
    text: `What is shown in ${refs[0]!.attachmentId}?`,
    newAttachmentIds: refs.map((ref) => ref.attachmentId),
  }

  await processMessage(reply, attachmentCtx, null, input)

  const modelUserMessage = capturedMessages[capturedMessages.length - 1] as ModelMessage
  expect(Array.isArray(modelUserMessage.content)).toBe(true)
  expect(getCachedHistory(attachmentCtx)[0]?.content).toContain('[User attached')
})
```

- [ ] **Step 2: Run the LLM test to verify it fails**

Run: `bun test tests/llm-orchestrator.test.ts`
Expected: FAIL because `processMessage()` still expects a string and never sends multipart content

- [ ] **Step 3: Resolve attachments for the current turn, build multipart content, and persist placeholders**

```typescript
// src/llm-orchestrator.ts
import {
  buildHistoryAttachmentLines,
  listActiveAttachments,
  loadAttachmentRecord,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './attachments/index.js'
import type { ProcessMessageInput } from './llm-orchestrator-types.js'

const buildUserTurnMessages = async (
  contextId: string,
  modelName: string,
  input: ProcessMessageInput,
): Promise<{ modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const activeAttachments = listActiveAttachments(contextId)
  const selected = selectAttachmentsForTurn({
    text: input.text,
    newAttachmentIds: input.newAttachmentIds,
    activeAttachments,
  })

  const historyLines = buildHistoryAttachmentLines(selected)

  if (!supportsAttachmentModelInput(modelName)) {
    return {
      modelMessage: { role: 'user', content: [...historyLines, input.text].join('\n\n') },
      historyMessage: { role: 'user', content: [...historyLines, input.text].join('\n\n') },
    }
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: Buffer; mediaType?: string }
    | { type: 'file'; data: Buffer; filename?: string; mediaType: string }
  > = []

  for (const attachment of selected) {
    const record = await loadAttachmentRecord(contextId, attachment.attachmentId)
    if (record === null) continue

    if ((record.mimeType ?? '').startsWith('image/')) {
      parts.push({ type: 'image', image: record.content, mediaType: record.mimeType })
    } else if (record.mimeType !== undefined) {
      parts.push({ type: 'file', data: record.content, filename: record.filename, mediaType: record.mimeType })
    }
  }

  parts.push({ type: 'text', text: input.text })

  return {
    modelMessage: { role: 'user', content: parts },
    historyMessage: { role: 'user', content: [...historyLines, input.text].join('\n\n') },
  }
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  input: ProcessMessageInput,
  deps: LlmOrchestratorDeps = defaultDeps,
): Promise<void> => {
  const baseHistory = getCachedHistory(contextId)
  const mainModel = getConfig(contextId, 'main_model') ?? ''
  const { modelMessage, historyMessage } = await buildUserTurnMessages(contextId, mainModel, input)
  const history = [...baseHistory, historyMessage]
  appendHistory(contextId, [historyMessage])

  try {
    const result = await callLlm(reply, contextId, username, [...baseHistory, modelMessage], deps)
    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) appendHistory(contextId, assistantMessages)
    if (shouldTriggerTrim([...history, ...assistantMessages])) {
      void runTrimInBackground(contextId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(contextId, baseHistory)
    await handleMessageError(reply, contextId, error)
  }
}
```

- [ ] **Step 4: Run the LLM test to verify it passes**

Run: `bun test tests/llm-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator.ts src/llm-orchestrator-types.ts tests/llm-orchestrator.test.ts
git commit -m "feat(llm): add multimodal attachment input"
```

---

### Final verification

After Task 7 is committed, run the full repo check plus the targeted attachment / queue / clear suites:

```bash
bun run check:full \
  && bun test tests/attachments tests/message-queue tests/commands/clear.test.ts tests/chat/telegram/index.test.ts tests/chat/mattermost/index.test.ts
```

Expected: PASS for repo checks, new attachment tests, queue tests, `/clear`, and existing Telegram/Mattermost ingress guardrails. (Discord ingress is intentionally untouched — the provider already does not advertise `files.receive`.)
