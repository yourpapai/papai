<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Audio Transcribe UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic pre-turn transcription of voice notes via a generic attachment-transformer plugin hook, with scenario-aware origin tagging, forwarded-voice attribution, in-turn failure injection, execute-time plugin config, and admin-trusted custom endpoints.

**Architecture:** Core gains a generic `attachmentTransformers` plugin contribution dispatched from `buildUserTurnMessages`; voice-origin attachments (tagged at the adapter, persisted in new DB columns) are transcribed before the model sees the turn. The `audio-transcribe` plugin registers a transformer sharing internals with its existing `transcribe` tool. Group voice notes are eagerly resolved from the staged-file store. Audio bytes never reach the LLM as content parts.

**Tech Stack:** TypeScript, Bun, Drizzle/SQLite, Zod v4, existing plugin system (`src/plugins/`), existing attachment workspace (`src/attachments/`).

**Spec:** `docs/superpowers/specs/2026-06-12-audio-transcribe-ux-fixes-design.md`

**Scope note (discovered during planning):** the Discord adapter does not populate `files`/`fileCandidates` at all today, so there is no Discord file pipeline to tag. Discord work is OUT of this plan; the `origin` plumbing defaults to `'file'` whenever Discord later gains file extraction. Mattermost needs no change (`origin` defaults to `'file'`).

---

## File Structure

```text
src/
├── db/
│   ├── migrations/054_attachment_origin.ts   [NEW] origin + forwarded_from columns
│   ├── attachments-schema.ts                 [MODIFY] add columns
│   ├── staged-schema.ts                      [MODIFY] add columns
│   └── index.ts                              [MODIFY] register migration 054
├── attachments/
│   ├── types.ts                              [MODIFY] AttachmentOrigin; fields on StoredAttachment/SaveAttachmentInput/StageFileParams/StagedFileRef
│   ├── store.ts                              [MODIFY] persist + map new columns
│   ├── staged.ts                             [MODIFY] stage + map + thread origin through resolution
│   └── ingest.ts                             [MODIFY] thread origin/forwardedFrom from IncomingFile
├── chat/
│   ├── types.ts                              [MODIFY] origin/forwardedFrom on IncomingFile + IncomingFileCandidate
│   └── telegram/file-helpers.ts              [MODIFY] voice origin tag + forward_origin capture
├── bot-attachments.ts                        [MODIFY] thread fields when staging; new resolveVoiceStagedFiles
├── bot.ts                                    [MODIFY] eager-resolve voice staged files in handleMessage
├── plugins/
│   ├── types.ts                              [MODIFY] manifest: contributes.attachmentTransformers + providerAllowedHostsFromConfig
│   ├── runtime-types.ts                      [MODIFY] PluginAttachmentTransformer types; contextConfig on runtime context
│   ├── attachment-types.ts                   [MODIFY] origin/forwardedFrom on PluginAttachmentRecord
│   ├── registration-support.ts               [MODIFY] transformer named registration
│   ├── context.ts                            [MODIFY] registerAttachmentTransformer; dynamic provider hosts wiring
│   ├── contributions.ts                      [MODIFY] store transformers in registry
│   ├── tool-runtime.ts                       [MODIFY] contextConfig facade; record mapping
│   ├── provider-runtime.ts                   [MODIFY] dynamic (admin-config) hosts
│   └── attachment-transform.ts               [NEW] dispatch + rendering
├── llm-orchestrator-attachments.ts           [MODIFY] transform integration; audio part suppression; unified text
plugins/audio-transcribe/
├── plugin.json                               [MODIFY] v2 manifest
└── index.ts                                  [MODIFY] transformer + execute-time config + shared internals
```

---

### Task 1: Migration 054 — origin and forwarded_from columns

**Files:**

- Create: `src/db/migrations/054_attachment_origin.ts`
- Modify: `src/db/attachments-schema.ts`
- Modify: `src/db/staged-schema.ts`
- Modify: `src/db/index.ts` (MIGRATIONS array)
- Test: `tests/db/staged-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/db/staged-schema.test.ts` (follow the file's existing setup pattern — it uses `setupTestDb()` and drizzle inserts):

```typescript
test('staged_files and attachments accept origin and forwarded_from', async () => {
  const db = getDrizzleDb()
  db.insert(stagedFiles)
    .values({
      stagedId: 'stg_origin_test',
      contextId: 'ctx-origin',
      senderId: 'user-1',
      filename: 'voice.ogg',
      platformFileId: 'pf-origin-1',
      sourceProvider: 'telegram',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      origin: 'voice',
      forwardedFrom: 'Alice',
    })
    .run()
  const row = db.select().from(stagedFiles).where(eq(stagedFiles.stagedId, 'stg_origin_test')).get()
  expect(row?.origin).toBe('voice')
  expect(row?.forwardedFrom).toBe('Alice')
})
```

(Import `getDrizzleDb`, `stagedFiles`, `eq` per the file's existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/staged-schema.test.ts`
Expected: FAIL — drizzle type error / `no such column: origin`

- [ ] **Step 3: Implement migration and schema**

```typescript
// src/db/migrations/054_attachment_origin.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:054' })

const up = (db: Database): void => {
  db.run(`ALTER TABLE attachments ADD COLUMN origin TEXT`)
  db.run(`ALTER TABLE attachments ADD COLUMN forwarded_from TEXT`)
  db.run(`ALTER TABLE staged_files ADD COLUMN origin TEXT`)
  db.run(`ALTER TABLE staged_files ADD COLUMN forwarded_from TEXT`)
  log.info('migration 054: attachment origin columns added')
}

export const migration054AttachmentOrigin: Migration = {
  id: '054_attachment_origin',
  up,
}

export default migration054AttachmentOrigin
```

In `src/db/attachments-schema.ts`, add after `lastUsedAt`:

```typescript
    origin: text('origin'),
    forwardedFrom: text('forwarded_from'),
```

In `src/db/staged-schema.ts`, add after `expiresAt`:

```typescript
    origin: text('origin'),
    forwardedFrom: text('forwarded_from'),
```

In `src/db/index.ts`: `import migration054AttachmentOrigin from './migrations/054_attachment_origin.js'` and append `migration054AttachmentOrigin,` to the `MIGRATIONS` array (after migration 053).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/db/staged-schema.test.ts tests/attachments/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/054_attachment_origin.ts src/db/attachments-schema.ts src/db/staged-schema.ts src/db/index.ts tests/db/staged-schema.test.ts
git commit -m "feat(attachments): add origin and forwarded_from columns (migration 054)"
```

---

### Task 2: Attachment types and store/staged plumbing

**Files:**

- Modify: `src/attachments/types.ts`
- Modify: `src/attachments/store.ts`
- Modify: `src/attachments/staged.ts`
- Test: `tests/attachments/store.test.ts`, `tests/attachments/staged.test.ts` (or the existing staged test file — check `ls tests/attachments/`)

- [ ] **Step 1: Write the failing tests**

Add to `tests/attachments/store.test.ts`:

```typescript
test('persists and round-trips origin and forwardedFrom', async () => {
  const ref = await saveAttachment({
    contextId: 'ctx-origin',
    sourceProvider: 'telegram',
    filename: 'voice.ogg',
    status: 'available',
    content: Buffer.from('audio'),
    mimeType: 'audio/ogg',
    origin: 'voice',
    forwardedFrom: 'Alice',
  })
  const stored = await loadAttachmentRecord('ctx-origin', ref.attachmentId)
  expect(stored?.origin).toBe('voice')
  expect(stored?.forwardedFrom).toBe('Alice')
})

test('origin and forwardedFrom are absent when not provided', async () => {
  const ref = await saveAttachment({
    contextId: 'ctx-origin',
    sourceProvider: 'telegram',
    filename: 'doc.pdf',
    status: 'available',
    content: Buffer.from('pdf'),
  })
  const stored = await loadAttachmentRecord('ctx-origin', ref.attachmentId)
  expect(stored?.origin).toBeUndefined()
  expect(stored?.forwardedFrom).toBeUndefined()
})
```

Add to the staged tests (same file that already covers `stageFileMetadata`/`resolveStagedFile`):

```typescript
test('stageFileMetadata persists origin and forwardedFrom; resolveStagedFile threads them onto the attachment', async () => {
  const staged = stageFileMetadata({
    contextId: 'ctx-voice',
    messageId: 'm-1',
    senderId: 'u-1',
    senderUsername: null,
    filename: 'voice.ogg',
    mimeType: 'audio/ogg',
    size: 5,
    platformFileId: 'pf-voice-1',
    sourceProvider: 'telegram',
    sourcePlatformInstanceId: 'pi-1',
    origin: 'voice',
    forwardedFrom: 'Alice',
  })
  expect(staged.origin).toBe('voice')
  expect(staged.forwardedFrom).toBe('Alice')

  const result = await resolveStagedFile(staged.stagedId, 'ctx-voice', async () => Buffer.from('audio'))
  expect('attachmentId' in result).toBe(true)
  if ('attachmentId' in result && !('message' in result)) {
    const stored = await loadAttachmentRecord('ctx-voice', result.attachmentId)
    expect(stored?.origin).toBe('voice')
    expect(stored?.forwardedFrom).toBe('Alice')
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/attachments/`
Expected: FAIL — `origin` not assignable to `SaveAttachmentInput` / `StageFileParams`

- [ ] **Step 3: Implement type and mapping changes**

`src/attachments/types.ts` — add near the top:

```typescript
export type AttachmentOrigin = 'voice' | 'file'

export const toAttachmentOrigin = (value: string | null): AttachmentOrigin | undefined => {
  if (value === 'voice') return 'voice'
  if (value === 'file') return 'file'
  return undefined
}
```

Extend `StoredAttachment`'s `Partial<{...}>` block with:

```typescript
origin: AttachmentOrigin
forwardedFrom: string
```

Extend `SaveAttachmentInput`'s `Partial<{...}>` block with the same two fields.

Extend `StagedFileRef` (non-partial, nullable style) with:

```typescript
origin: AttachmentOrigin | null
forwardedFrom: string | null
```

Extend `StageFileParams` with:

```typescript
origin: AttachmentOrigin | null
forwardedFrom: string | null
```

`src/attachments/store.ts`:

- In `saveAttachment`'s `.values({...})` insert object, add:

```typescript
      origin: input.origin ?? null,
      forwardedFrom: input.forwardedFrom ?? null,
```

- In `loadAttachmentRecord`'s mapping block (after `if (row.lastUsedAt !== null) ...`), add:

```typescript
const origin = toAttachmentOrigin(row.origin)
if (origin !== undefined) stored.origin = origin
if (row.forwardedFrom !== null) stored.forwardedFrom = row.forwardedFrom
```

(import `toAttachmentOrigin` from `./types.js`).

`src/attachments/staged.ts`:

- In `buildStagedValues`, add:

```typescript
  origin: params.origin,
  forwardedFrom: params.forwardedFrom,
```

- In `stageFileMetadata`'s `onConflictDoUpdate.set`, add:

```typescript
        origin: params.origin,
        forwardedFrom: params.forwardedFrom,
```

- In `toRef`, add:

```typescript
  origin: toAttachmentOrigin(row.origin) ?? null,
  forwardedFrom: row.forwardedFrom,
```

(import `toAttachmentOrigin` from `./types.js`).

- In `downloadAndPersist`, thread the fields into `saveAttachment`:

```typescript
const origin = toAttachmentOrigin(row.origin)
const forwardedFrom = toUndefinedIfNull(row.forwardedFrom)

const attachmentRef = await saveAttachment({
  contextId: row.contextId,
  sourceProvider: toSourceProvider(row.sourceProvider),
  filename: row.filename,
  mimeType,
  size,
  content,
  status: 'available',
  sourceMessageId,
  sourceFileId: row.platformFileId,
  ...(origin === undefined ? {} : { origin }),
  ...(forwardedFrom === undefined ? {} : { forwardedFrom }),
})
```

Existing callers of `stageFileMetadata` will now fail typecheck (the two new required nullable fields). Update the caller in `src/bot-attachments.ts`'s `stageGroupFileCandidates` loop to pass:

```typescript
        origin: candidate.origin ?? null,
        forwardedFrom: candidate.forwardedFrom ?? null,
```

(`candidate.origin`/`candidate.forwardedFrom` do not exist on `IncomingFileCandidate` until Task 3 — for THIS task, pass `origin: null, forwardedFrom: null` literals, and Task 3 replaces them. Fix any other `stageFileMetadata` callers in tests the same way with `origin: null, forwardedFrom: null`.)

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test tests/attachments/ && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/ src/bot-attachments.ts tests/attachments/
git commit -m "feat(attachments): persist origin and forwarded_from through store and staged resolution"
```

---

### Task 3: IncomingFile origin fields and Telegram capture

**Files:**

- Modify: `src/chat/types.ts:81-101`
- Modify: `src/chat/telegram/file-helpers.ts`
- Test: `tests/chat/telegram/file-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/chat/telegram/file-helpers.test.ts`:

```typescript
test('voice candidate is tagged origin voice', () => {
  const candidates = extractFileCandidatesFromContext({
    message: { voice: { file_id: 'v1', file_size: 10 } },
  })
  expect(candidates).toHaveLength(1)
  expect(candidates[0]?.origin).toBe('voice')
})

test('audio and document candidates have no voice origin', () => {
  const candidates = extractFileCandidatesFromContext({
    message: { audio: { file_id: 'a1', file_name: 'song.mp3', mime_type: 'audio/mpeg' } },
  })
  expect(candidates[0]?.origin).toBeUndefined()
})

test('forwarded message sets forwardedFrom from a visible user', () => {
  const candidates = extractFileCandidatesFromContext({
    message: {
      voice: { file_id: 'v1' },
      forward_origin: { type: 'user', sender_user: { first_name: 'Alice', last_name: 'Smith' } },
    },
  })
  expect(candidates[0]?.forwardedFrom).toBe('Alice Smith')
})

test('forwarded message sets forwardedFrom from a hidden user name', () => {
  const candidates = extractFileCandidatesFromContext({
    message: {
      voice: { file_id: 'v1' },
      forward_origin: { type: 'hidden_user', sender_user_name: 'Bob' },
    },
  })
  expect(candidates[0]?.forwardedFrom).toBe('Bob')
})

test('non-forwarded message has no forwardedFrom', () => {
  const candidates = extractFileCandidatesFromContext({ message: { voice: { file_id: 'v1' } } })
  expect(candidates[0]?.forwardedFrom).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/chat/telegram/file-helpers.test.ts`
Expected: FAIL — `origin` does not exist on `IncomingFileCandidate`

- [ ] **Step 3: Implement**

`src/chat/types.ts` — extend both `IncomingFile` and `IncomingFileCandidate` `Partial<{...}>` blocks with:

```typescript
/** How the file arrived: a recorded voice note vs an ordinary file. Default 'file'. */
origin: 'voice' | 'file'
/** Display name of the original sender when the message was forwarded. */
forwardedFrom: string
```

`src/chat/telegram/file-helpers.ts`:

Extend `ExtractFilesInput.message` with:

```typescript
    forward_origin?: {
      type: string
      sender_user?: { first_name: string; last_name?: string }
      sender_user_name?: string
      sender_chat?: { title?: string }
      chat?: { title?: string }
    }
```

Extend the local `FileCandidate` type:

```typescript
type FileCandidate = {
  fileId: string
  filename: string
  mimeType?: string
  size?: number
  origin?: 'voice' | 'file'
  forwardedFrom?: string
}
```

Tag the voice candidate (in `getVoiceCandidate`'s returned object) with:

```typescript
        origin: 'voice',
```

Add the forward extraction helper and apply it in `buildFileCandidates`:

```typescript
const extractForwardedFrom = (msg: ExtractFilesInput['message']): string | undefined => {
  const fwd = msg?.forward_origin
  if (fwd === undefined) return undefined
  if (fwd.sender_user !== undefined) {
    const last = fwd.sender_user.last_name
    return last === undefined ? fwd.sender_user.first_name : `${fwd.sender_user.first_name} ${last}`
  }
  if (fwd.sender_user_name !== undefined) return fwd.sender_user_name
  if (fwd.sender_chat?.title !== undefined) return fwd.sender_chat.title
  if (fwd.chat?.title !== undefined) return fwd.chat.title
  return 'unknown sender'
}

function buildFileCandidates(msg: ExtractFilesInput['message']): FileCandidate[] {
  const forwardedFrom = extractForwardedFrom(msg)
  return [
    getDocumentCandidate(msg),
    getPhotoCandidate(msg),
    getAudioCandidate(msg),
    getVideoCandidate(msg),
    getVoiceCandidate(msg),
  ]
    .filter((candidate): candidate is FileCandidate => candidate !== undefined)
    .map((candidate) => (forwardedFrom === undefined ? candidate : { ...candidate, forwardedFrom }))
}
```

`extractFilesFromContext` already spreads the candidate into the `IncomingFile` (`{ ...candidate, content }`), so files inherit both fields with no further change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/chat/telegram/file-helpers.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/types.ts src/chat/telegram/file-helpers.ts tests/chat/telegram/file-helpers.test.ts
git commit -m "feat(telegram): tag voice origin and capture forward attribution on extracted files"
```

---

### Task 4: Thread origin through DM ingest and group staging

**Files:**

- Modify: `src/attachments/ingest.ts`
- Modify: `src/bot-attachments.ts` (replace the Task 2 `origin: null` literals)
- Test: `tests/bot-attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/bot-attachments.test.ts` (follow the file's existing mock/DI pattern):

```typescript
test('DM ingest persists origin and forwardedFrom from IncomingFile', async () => {
  const refs = await persistIncomingAttachments({
    contextId: 'ctx-dm',
    sourceProvider: 'telegram',
    files: [
      {
        fileId: 'f1',
        filename: 'voice.ogg',
        content: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        origin: 'voice',
        forwardedFrom: 'Alice',
      },
    ],
  })
  const stored = await loadAttachmentRecord('ctx-dm', refs[0]!.attachmentId)
  expect(stored?.origin).toBe('voice')
  expect(stored?.forwardedFrom).toBe('Alice')
})

test('group staging passes candidate origin to stageFileMetadata', () => {
  const staged: StageFileParams[] = []
  stageGroupFileCandidates(
    {
      storageContextId: 'ctx-g',
      msg: makeGroupMessageWithCandidates([
        { fileId: 'pf1', filename: 'voice.ogg', mimeType: 'audio/ogg', origin: 'voice' },
      ]),
      sourceProvider: 'telegram',
    },
    {
      stageFileMetadataFn: (params) => {
        staged.push(params)
        return makeStagedRef(params)
      },
    },
  )
  expect(staged[0]?.origin).toBe('voice')
})
```

(Reuse/extend the file's existing helpers for building a group `IncomingMessage` and a `StagedFileRef`; if none exist for the DI dep, build the params assertion with the existing test style.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bot-attachments.test.ts`
Expected: FAIL — stored origin undefined / staged origin null

- [ ] **Step 3: Implement**

`src/attachments/ingest.ts` — in `buildInput`, add:

```typescript
if (file.origin !== undefined) input.origin = file.origin
if (file.forwardedFrom !== undefined) input.forwardedFrom = file.forwardedFrom
```

`src/bot-attachments.ts` — in the `stageGroupFileCandidates` loop, replace the Task 2 placeholders with:

```typescript
        origin: candidate.origin ?? null,
        forwardedFrom: candidate.forwardedFrom ?? null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bot-attachments.test.ts tests/attachments/ && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/ingest.ts src/bot-attachments.ts tests/bot-attachments.test.ts
git commit -m "feat(attachments): thread origin and forward attribution through ingest and staging"
```

---

### Task 5: Manifest schema — attachmentTransformers and providerAllowedHostsFromConfig

**Files:**

- Modify: `src/plugins/types.ts` (pluginManifestSchema)
- Test: `tests/plugins/manifest-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/plugins/manifest-schema.test.ts` (reuse the file's `makeManifest`-style base object):

```typescript
test('accepts contributes.attachmentTransformers with attachments.read permission', () => {
  const result = pluginManifestSchema.safeParse(
    makeRawManifest({
      contributes: { tools: [], promptFragments: [], attachmentTransformers: ['my-transformer'] },
      permissions: ['attachments.read'],
    }),
  )
  expect(result.success).toBe(true)
})

test('rejects attachmentTransformers without attachments.read permission', () => {
  const result = pluginManifestSchema.safeParse(
    makeRawManifest({
      contributes: { tools: [], promptFragments: [], attachmentTransformers: ['my-transformer'] },
      permissions: [],
    }),
  )
  expect(result.success).toBe(false)
})

test('accepts providerAllowedHostsFromConfig referencing an admin-scoped config key', () => {
  const result = pluginManifestSchema.safeParse(
    makeRawManifest({
      permissions: ['http'],
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [{ key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' }],
    }),
  )
  expect(result.success).toBe(true)
})

test('rejects providerAllowedHostsFromConfig referencing a context-scoped or missing key', () => {
  const result = pluginManifestSchema.safeParse(
    makeRawManifest({
      permissions: ['http'],
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [],
    }),
  )
  expect(result.success).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/manifest-schema.test.ts`
Expected: FAIL — unknown key `attachmentTransformers` (the contributes object is strict) or unknown `providerAllowedHostsFromConfig`

- [ ] **Step 3: Implement schema changes**

In `src/plugins/types.ts`:

1. In the `contributes` zod object, add alongside `tools`:

```typescript
    attachmentTransformers: z.array(contributionNameSchema).optional().default([]),
```

(use the exact same name schema the sibling `tools` entry uses — locate it in the file; it may be inline `z.string().regex(...)`.)

2. At the manifest top level, alongside `providerAllowedHosts`, add:

```typescript
    providerAllowedHostsFromConfig: z.array(z.string().min(1)).optional().default([]),
```

3. After the existing `.refine(...)` chain entries, add two refinements:

```typescript
  .refine((m) => m.contributes.attachmentTransformers.length === 0 || m.permissions.includes('attachments.read'), {
    message: "Declaring contributes.attachmentTransformers requires the 'attachments.read' permission",
    path: ['permissions'],
  })
  .refine(
    (m) =>
      m.providerAllowedHostsFromConfig.every((key) =>
        m.configRequirements.some((req) => req.key === key && req.scope === 'admin'),
      ),
    {
      message: 'providerAllowedHostsFromConfig keys must reference admin-scoped configRequirements',
      path: ['providerAllowedHostsFromConfig'],
    },
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/plugins/manifest-schema.test.ts tests/plugins/types.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/types.ts tests/plugins/manifest-schema.test.ts
git commit -m "feat(plugins): manifest schema for attachment transformers and config-sourced allowed hosts"
```

---

### Task 6: Transformer types, registration, and contributions registry

**Files:**

- Modify: `src/plugins/runtime-types.ts`
- Modify: `src/plugins/registration-support.ts`
- Modify: `src/plugins/context.ts`
- Modify: `src/plugins/contributions.ts`
- Test: `tests/plugins/contributions.test.ts` (or `tests/plugins/context.test.ts` — match where registration gating is tested today)

- [ ] **Step 1: Write the failing tests**

```typescript
test('registerAttachmentTransformer collects a declared transformer', () => {
  const manifest = makeManifest({
    contributes: { ...baseContributes, attachmentTransformers: ['my-transformer'] },
    permissions: ['attachments.read'],
  })
  const built = buildPluginContext(manifest, '__system__')
  built.ctx.registration.registerAttachmentTransformer({
    name: 'my-transformer',
    mimePrefixes: ['audio/'],
    transform: () => Promise.resolve({ ok: true, text: 'hi' }),
  })
  expect(built.collected.attachmentTransformers).toHaveLength(1)
})

test('registerAttachmentTransformer rejects an undeclared name', () => {
  const manifest = makeManifest({ permissions: ['attachments.read'] })
  const built = buildPluginContext(manifest, '__system__')
  expect(() =>
    built.ctx.registration.registerAttachmentTransformer({
      name: 'nope',
      mimePrefixes: ['audio/'],
      transform: () => Promise.resolve({ ok: true, text: 'hi' }),
    }),
  ).toThrow(/not declared/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/contributions.test.ts`
Expected: FAIL — `registerAttachmentTransformer` does not exist

- [ ] **Step 3: Implement**

`src/plugins/runtime-types.ts` — add the new types and extend `PluginContributions`:

```typescript
import type { PluginAttachmentRecord } from './attachment-types.js'

export type AttachmentTransformResult =
  | { ok: true; text: string; meta?: { language?: string; durationSec?: number } }
  | { ok: false; reason: string }

export type PluginAttachmentTransformer = {
  name: string
  /** Matched against attachment mimeType, e.g. ['audio/'] */
  mimePrefixes: readonly string[]
  /** Fallback match when the attachment has no MIME type, e.g. ['.ogg', '.mp3'] */
  filenameExtensions?: readonly string[]
  /** Restrict to attachment origins; omitted means all origins */
  origins?: readonly ('voice' | 'file')[]
  /** Per-call budget enforced by core; bounded 1000–120000, default 30000 */
  timeoutMs?: number
  transform(
    record: PluginAttachmentRecord,
    runtimeContext: PluginToolRuntimeContext,
  ): Promise<AttachmentTransformResult>
}
```

Extend `PluginContributions` with:

```typescript
  attachmentTransformers?: PluginAttachmentTransformer[]
```

`src/plugins/registration-support.ts`:

- Add `declaredTransformers` / `registeredTransformers` to `RegistrationNames` (from `manifest.contributes.attachmentTransformers`), add `'Attachment transformer'` to `RegistrationKind`, add `PluginAttachmentTransformer` to `SupportedRegistration`, and add:

```typescript
function buildAttachmentTransformerRegistration(
  names: RegistrationNames,
  args: { activationGuard: ActivationGuard; registerAttachmentTransformer(t: PluginAttachmentTransformer): void },
): (transformer: PluginAttachmentTransformer) => void {
  return buildNamedRegistration({
    kind: 'Attachment transformer',
    declarationErrorMessage:
      "Attachment transformer '{name}' is not declared in plugin manifest contributes.attachmentTransformers",
    declared: names.declaredTransformers,
    registered: names.registeredTransformers,
    activationGuard: args.activationGuard,
    readName: (transformer) => transformer.name,
    onRegister: (transformer) => {
      args.registerAttachmentTransformer(transformer)
    },
  })
}
```

- Add `registerAttachmentTransformer` to `buildNamedRegistrationHandlers`'s args and return object (mirroring `registerTool` exactly).

`src/plugins/context.ts`:

- Add to `PluginRegistration`:

```typescript
  /** Register an attachment transformer. The name must match a declared contributes.attachmentTransformers entry. */
  registerAttachmentTransformer(transformer: PluginAttachmentTransformer): void
```

- In `buildRegistration`, pass the handler and expose it:

```typescript
    registerAttachmentTransformer: (transformer) => {
      collected.attachmentTransformers = [...(collected.attachmentTransformers ?? []), transformer]
    },
```

(in the `buildNamedRegistrationHandlers` args), and in the frozen return object:

```typescript
    registerAttachmentTransformer(transformer: PluginAttachmentTransformer): void {
      namedRegistrations.registerAttachmentTransformer(transformer)
    },
```

`src/plugins/contributions.ts`:

- Add `attachmentTransformers: PluginAttachmentTransformer[]` to `ActivePluginContributions`.
- In `register(...)`, populate it from the collected contributions using the same declared-name filter the other kinds use (skip undeclared, log warn), defaulting to `[]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/plugins/ && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/runtime-types.ts src/plugins/registration-support.ts src/plugins/context.ts src/plugins/contributions.ts tests/plugins/
git commit -m "feat(plugins): attachment transformer contribution type and registration"
```

---

### Task 7: contextConfig facade and attachment record origin fields

**Files:**

- Modify: `src/plugins/runtime-types.ts` (PluginToolRuntimeContext)
- Modify: `src/plugins/tool-runtime.ts`
- Modify: `src/plugins/attachment-types.ts`
- Test: `tests/plugins/tool-runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/plugins/tool-runtime.test.ts`:

```typescript
test('contextConfig resolves declared context-scoped keys and hides others', () => {
  setPluginConfig('ctx-1', 'test-plugin', 'api_key', 'ctx-key-1')
  const ctx = buildPluginToolRuntimeContext(
    'test-plugin',
    makeManifest({
      configRequirements: [{ key: 'api_key', label: 'API Key', required: false, sensitive: true, scope: 'context' }],
    }),
    makeRuntime({ storageContextId: 'ctx-1' }),
  )
  expect(ctx.contextConfig.get('api_key')).toBe('ctx-key-1')
  expect(ctx.contextConfig.get('undeclared')).toBeUndefined()
})

test('attachments.read surfaces origin and forwardedFrom on the record', async () => {
  const saved = await saveAttachment({
    contextId: 'ctx-1',
    sourceProvider: 'telegram',
    filename: 'voice.ogg',
    status: 'available',
    content: Buffer.from('audio'),
    mimeType: 'audio/ogg',
    origin: 'voice',
    forwardedFrom: 'Alice',
  })
  const ctx = buildPluginToolRuntimeContext(
    'test-plugin',
    makeManifest({ permissions: ['attachments.read'] }),
    makeRuntime({ storageContextId: 'ctx-1' }),
  )
  const { record } = await ctx.attachments.read(saved.attachmentId)
  expect(record.origin).toBe('voice')
  expect(record.forwardedFrom).toBe('Alice')
})
```

(import `setPluginConfig` from `../../src/config.js` — verify the exact setter name with `grep -n "setPluginConfig\|getPluginConfig" src/config.ts` and use the real one.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/tool-runtime.test.ts`
Expected: FAIL — `contextConfig` does not exist

- [ ] **Step 3: Implement**

`src/plugins/attachment-types.ts` — extend `PluginAttachmentRecord`:

```typescript
export type PluginAttachmentRecord = {
  attachmentId: string
  filename: string
  mimeType: string | undefined
  size: number | undefined
  createdAt: string
  /** How the file arrived ('voice' for voice notes); undefined for legacy rows. */
  origin?: 'voice' | 'file'
  /** Original sender display name when the source message was forwarded. */
  forwardedFrom?: string
}
```

`src/plugins/runtime-types.ts` — add to `PluginToolRuntimeContext`:

```typescript
  /** Context-scoped plugin config declared in configRequirements with scope 'context'. */
  contextConfig: { get(key: string): string | undefined }
```

`src/plugins/tool-runtime.ts`:

```typescript
import { getPluginConfig } from '../config.js'

function buildRuntimeContextConfig(
  pluginId: string,
  contextId: string,
  manifest: PluginManifest,
): PluginToolRuntimeContext['contextConfig'] {
  const contextKeys = new Set(
    manifest.configRequirements.filter((req) => req.scope === 'context').map((req) => req.key),
  )
  return Object.freeze({
    get(key: string): string | undefined {
      if (!contextKeys.has(key)) return undefined
      const value = getPluginConfig(contextId, pluginId, key)
      return value === null ? undefined : value
    },
  })
}
```

Add to the frozen object in `buildPluginToolRuntimeContext`:

```typescript
    contextConfig: buildRuntimeContextConfig(pluginId, runtime.storageContextId, manifest),
```

In `buildAttachmentsFacade`'s returned record, add:

```typescript
          ...(stored.origin === undefined ? {} : { origin: stored.origin }),
          ...(stored.forwardedFrom === undefined ? {} : { forwardedFrom: stored.forwardedFrom }),
```

Update the runtime-context mocks in `tests/plugins/audio-transcribe.test.ts` and `tests/plugins/synthetic-web-search.test.ts` with a stub:

```typescript
    contextConfig: { get: () => undefined },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/plugins/ && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ tests/plugins/
git commit -m "feat(plugins): context-scoped config facade and origin metadata on attachment records"
```

---

### Task 8: Provider runtime dynamic hosts from admin config

**Files:**

- Modify: `src/plugins/provider-runtime.ts`
- Modify: `src/plugins/context.ts` (wiring)
- Test: `tests/plugins/provider-runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/plugins/provider-runtime.test.ts`:

```typescript
test('allows a host contributed by dynamicHosts and skips the public-IP check for it', async () => {
  const fetchMock = mock(async () => new Response('ok', { status: 200 }))
  const assertPublicUrl = mock(async () => {
    throw new Error('private address')
  })
  const runtime = buildProviderRuntime(
    ['api.openai.com'],
    mockPluginLogger(),
    { fetch: fetchMock, assertPublicUrl },
    () => new Set(['whisper.lan']),
  )
  const response = await runtime.httpFetch('http://whisper.lan/v1/audio/transcriptions', { method: 'POST' })
  expect(response.status).toBe(200)
  expect(assertPublicUrl).not.toHaveBeenCalled()
})

test('static hosts still require https and the public-IP check', async () => {
  const assertPublicUrl = mock(async () => {
    throw new Error('private address')
  })
  const runtime = buildProviderRuntime(
    ['api.openai.com'],
    mockPluginLogger(),
    { fetch: mock(), assertPublicUrl },
    () => new Set(),
  )
  await expect(runtime.httpFetch('https://api.openai.com/x')).rejects.toThrow('private address')
})

test('rejects hosts in neither the static nor the dynamic set', async () => {
  const runtime = buildProviderRuntime(
    ['api.openai.com'],
    mockPluginLogger(),
    undefined,
    () => new Set(['whisper.lan']),
  )
  await expect(runtime.httpFetch('https://evil.example/x')).rejects.toThrow(/allowlist/)
})
```

(reuse the file's existing logger helper; if none, build `{debug:()=>{},info:()=>{},warn:()=>{},error:()=>{}}`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/provider-runtime.test.ts`
Expected: FAIL — `buildProviderRuntime` takes 3 args / host rejected

- [ ] **Step 3: Implement**

`src/plugins/provider-runtime.ts`:

```typescript
/** Hosts contributed dynamically (admin-scoped plugin config). Admin config is
 * operator-trusted input at the same trust level as manifest approval, so these
 * hosts skip BOTH the https requirement and the public-IP (SSRF) check — that is
 * deliberate, to support self-hosted endpoints on private networks. */
export type DynamicHostsFn = () => ReadonlySet<string>

const noDynamicHosts: DynamicHostsFn = () => new Set()

async function validateHop(
  url: URL,
  hostSet: ReadonlySet<string>,
  dynamicHosts: DynamicHostsFn,
  assertPublicUrl: (url: URL) => Promise<void>,
): Promise<void> {
  const host = url.hostname.toLowerCase()
  if (dynamicHosts().has(host)) return
  assertHttps(url)
  if (!hostSet.has(host)) {
    throw new Error(`Host '${url.hostname}' is not in the plugin providerAllowedHosts allowlist`)
  }
  await assertPublicUrl(url)
}
```

Thread `dynamicHosts` through `fetchWithRedirects` (add a `dynamicHosts: DynamicHostsFn` parameter, pass to the redirect-hop `validateHop` call) and change the signature:

```typescript
export function buildProviderRuntime(
  allowedHosts: readonly string[],
  logger: PluginLogger,
  deps: ProviderRuntimeDeps = defaultDeps,
  dynamicHosts: DynamicHostsFn = noDynamicHosts,
): PluginProviderRuntime
```

Both `validateHop` call sites pass `dynamicHosts`.

`src/plugins/context.ts` — in `buildPluginContext`, build the thunk and pass it:

```typescript
const buildDynamicHosts = (manifest: PluginManifest): (() => ReadonlySet<string>) => {
  const keys = manifest.providerAllowedHostsFromConfig
  return (): ReadonlySet<string> => {
    const hosts = new Set<string>()
    for (const key of keys) {
      const value = getPluginAdminConfig(manifest.id, key)
      if (value === undefined || value.trim() === '') continue
      try {
        hosts.add(new URL(value).hostname.toLowerCase())
      } catch {
        // ignore non-URL admin config values
      }
    }
    return hosts
  }
}
```

and:

```typescript
const providerRuntime =
  permissions.has('provider.task') || permissions.has('http')
    ? buildProviderRuntime(manifest.providerAllowedHosts, log, undefined, buildDynamicHosts(manifest))
    : undefined
```

(`buildProviderRuntime`'s third param must accept `undefined` → change the default-param signature to `deps: ProviderRuntimeDeps | undefined = defaultDeps` and normalize with `const resolvedDeps = deps ?? defaultDeps` inside.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/plugins/provider-runtime.test.ts tests/plugins/ && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/provider-runtime.ts src/plugins/context.ts tests/plugins/provider-runtime.test.ts
git commit -m "feat(plugins): admin-config-sourced dynamic hosts for plugin httpFetch"
```

---

### Task 9: Core dispatch and rendering module

**Files:**

- Create: `src/plugins/attachment-transform.ts`
- Test: `tests/plugins/attachment-transform.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/plugins/attachment-transform.test.ts — follow the DI/registry-stub pattern used in tests/plugins/contributions.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  matchesTransformer,
  renderTransformLine,
  transformNewAttachments,
} from '../../src/plugins/attachment-transform.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('matchesTransformer', () => {
  const transformer = {
    name: 't',
    mimePrefixes: ['audio/'],
    filenameExtensions: ['.ogg', '.mp3'],
    origins: ['voice'] as const,
    transform: () => Promise.resolve({ ok: true as const, text: 'x' }),
  }

  test('matches audio mime with voice origin', () => {
    expect(matchesTransformer(transformer, { mimeType: 'audio/ogg', filename: 'voice.ogg', origin: 'voice' })).toBe(
      true,
    )
  })
  test('falls back to extension when mime is missing', () => {
    expect(matchesTransformer(transformer, { mimeType: undefined, filename: 'note.OGG', origin: 'voice' })).toBe(true)
  })
  test('rejects non-voice origin when origins filter is set', () => {
    expect(matchesTransformer(transformer, { mimeType: 'audio/ogg', filename: 'song.ogg', origin: 'file' })).toBe(false)
    expect(matchesTransformer(transformer, { mimeType: 'audio/ogg', filename: 'song.ogg', origin: undefined })).toBe(
      false,
    )
  })
  test('rejects non-matching mime', () => {
    expect(matchesTransformer(transformer, { mimeType: 'image/png', filename: 'a.png', origin: 'voice' })).toBe(false)
  })
})

describe('renderTransformLine', () => {
  const record = { attachmentId: 'att_1', filename: 'voice.ogg', origin: 'voice' as const }

  test('success with duration and language', () => {
    const { line } = renderTransformLine(record, {
      ok: true,
      text: 'hello there',
      meta: { durationSec: 185, language: 'en' },
    })
    expect(line).toBe('[Voice attachment att_1 (3:05, en): "hello there"]')
  })
  test('success without meta omits the parens', () => {
    const { line } = renderTransformLine(record, { ok: true, text: 'hi' })
    expect(line).toBe('[Voice attachment att_1: "hi"]')
  })
  test('forwarded attribution', () => {
    const { line } = renderTransformLine({ ...record, forwardedFrom: 'Alice' }, { ok: true, text: 'hi' })
    expect(line).toBe('[Forwarded voice from "Alice" att_1: "hi"]')
  })
  test('failure line', () => {
    const { line } = renderTransformLine(record, { ok: false, reason: 'file too large (max 24 MiB)' })
    expect(line).toBe('[Voice attachment att_1: transcription unavailable — file too large (max 24 MiB)]')
  })
  test('history line truncates at 120 chars', () => {
    const long = 'x'.repeat(150)
    const { historyLine } = renderTransformLine(record, { ok: true, text: long })
    expect(historyLine).toBe(`[User attached att_1: voice.ogg — "${'x'.repeat(120)}…"]`)
  })
  test('failure history line is the plain attached line', () => {
    const { historyLine } = renderTransformLine(record, { ok: false, reason: 'nope' })
    expect(historyLine).toBe('[User attached att_1: voice.ogg]')
  })
})

describe('transformNewAttachments', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty map when no plugins are active', async () => {
    const result = await transformNewAttachments('ctx-none', 'user-1', [])
    expect(result.size).toBe(0)
  })

  test('timeout produces a failure line', async () => {
    const slow = {
      name: 'slow',
      mimePrefixes: ['audio/'],
      timeoutMs: 1000,
      transform: () => new Promise<never>(() => {}),
    }
    const line = await executeTransformer(slow, makeVoiceRecord(), makeStubRuntimeContext())
    expect(line.line).toContain('transcription unavailable')
  })

  test('a throwing transformer produces a failure line', async () => {
    const bad = {
      name: 'bad',
      mimePrefixes: ['audio/'],
      transform: () => Promise.reject(new Error('boom')),
    }
    const line = await executeTransformer(bad, makeVoiceRecord(), makeStubRuntimeContext())
    expect(line.line).toContain('transcription unavailable')
  })
})
```

Helpers for the last two tests: `executeTransformer` is exported from the module (the timeout/catch wrapper). `makeVoiceRecord()` builds `{ attachmentId: 'att_t', filename: 'voice.ogg', mimeType: 'audio/ogg', size: 1, createdAt: '2026-01-01T00:00:00.000Z', origin: 'voice' }`; `makeStubRuntimeContext()` reuses the runtime-context mock shape from `tests/plugins/audio-transcribe.test.ts` (kv/adminConfig/contextConfig/rateLimit/attachments stubs). The slow test uses the 1000ms floor so the suite stays fast.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/attachment-transform.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the module**

```typescript
// src/plugins/attachment-transform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StoredAttachment } from '../attachments/types.js'
import { logger } from '../logger.js'
import type { PluginAttachmentRecord } from './attachment-types.js'
import { contributionRegistry } from './contributions.js'
import { getPluginsForContext } from './registry.js'
import type {
  AttachmentTransformResult,
  PluginAttachmentTransformer,
  PluginToolRuntimeContext,
} from './runtime-types.js'
import { buildPluginToolRuntimeContext } from './tool-runtime.js'

const log = logger.child({ scope: 'plugins:attachment-transform' })

const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000
const DEFAULT_TIMEOUT_MS = 30_000
const HISTORY_TRANSCRIPT_MAX = 120

export type TransformLine = { line: string; historyLine: string }

type MatchableRecord = Pick<PluginAttachmentRecord, 'mimeType' | 'filename' | 'origin'>

export function matchesTransformer(
  transformer: Pick<PluginAttachmentTransformer, 'mimePrefixes' | 'filenameExtensions' | 'origins'>,
  record: MatchableRecord,
): boolean {
  const origin = record.origin ?? 'file'
  if (transformer.origins !== undefined && !transformer.origins.includes(origin)) return false
  if (record.mimeType !== undefined) {
    return transformer.mimePrefixes.some((prefix) => record.mimeType!.startsWith(prefix))
  }
  const extensions = transformer.filenameExtensions ?? []
  const lowerName = record.filename.toLowerCase()
  return extensions.some((ext) => lowerName.endsWith(ext.toLowerCase()))
}

const collapseWhitespace = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim()

const formatDuration = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const labelFor = (record: Pick<PluginAttachmentRecord, 'attachmentId' | 'origin' | 'forwardedFrom'>): string => {
  if (record.forwardedFrom !== undefined) return `Forwarded voice from "${record.forwardedFrom}" ${record.attachmentId}`
  if (record.origin === 'voice') return `Voice attachment ${record.attachmentId}`
  return `Attachment ${record.attachmentId}`
}

export function renderTransformLine(
  record: Pick<PluginAttachmentRecord, 'attachmentId' | 'filename' | 'origin' | 'forwardedFrom'>,
  result: AttachmentTransformResult,
): TransformLine {
  const label = labelFor(record)
  if (!result.ok) {
    return {
      line: `[${label}: transcription unavailable — ${collapseWhitespace(result.reason)}]`,
      historyLine: `[User attached ${record.attachmentId}: ${record.filename}]`,
    }
  }
  const metaParts: string[] = []
  if (result.meta?.durationSec !== undefined) metaParts.push(formatDuration(result.meta.durationSec))
  if (result.meta?.language !== undefined) metaParts.push(result.meta.language)
  const meta = metaParts.length === 0 ? '' : ` (${metaParts.join(', ')})`
  const text = collapseWhitespace(result.text)
  const truncated = text.length > HISTORY_TRANSCRIPT_MAX ? `${text.slice(0, HISTORY_TRANSCRIPT_MAX)}…` : text
  return {
    line: `[${label}${meta}: "${text}"]`,
    historyLine: `[User attached ${record.attachmentId}: ${record.filename} — "${truncated}"]`,
  }
}

const clampTimeout = (timeoutMs: number | undefined): number => {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs))
}

export async function executeTransformer(
  transformer: PluginAttachmentTransformer,
  record: PluginAttachmentRecord,
  runtimeContext: PluginToolRuntimeContext,
): Promise<TransformLine> {
  const timeoutMs = clampTimeout(transformer.timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AttachmentTransformResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, reason: 'transformation timed out' })
    }, timeoutMs)
  })
  try {
    const result = await Promise.race([transformer.transform(record, runtimeContext), timeout])
    return renderTransformLine(record, result)
  } catch (error) {
    log.warn(
      {
        transformer: transformer.name,
        attachmentId: record.attachmentId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Attachment transformer threw',
    )
    return renderTransformLine(record, { ok: false, reason: 'transformation failed' })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const toPluginRecord = (stored: StoredAttachment): PluginAttachmentRecord => ({
  attachmentId: stored.attachmentId,
  filename: stored.filename,
  mimeType: stored.mimeType,
  size: stored.size,
  createdAt: stored.createdAt,
  ...(stored.origin === undefined ? {} : { origin: stored.origin }),
  ...(stored.forwardedFrom === undefined ? {} : { forwardedFrom: stored.forwardedFrom }),
})

type ContextTransformer = {
  pluginId: string
  manifest: import('./types.js').PluginManifest
  transformer: PluginAttachmentTransformer
}

const collectContextTransformers = (contextId: string): ContextTransformer[] => {
  const plugins = [...getPluginsForContext(contextId)].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  const out: ContextTransformer[] = []
  for (const plugin of plugins) {
    const contributions = contributionRegistry.getContributions(plugin.manifest.id)
    if (contributions === undefined) continue
    for (const transformer of contributions.attachmentTransformers) {
      out.push({ pluginId: plugin.manifest.id, manifest: plugin.manifest, transformer })
    }
  }
  return out
}

/**
 * Transform new attachments for the current turn. Returns a map keyed by
 * attachmentId with the live manifest line and the persisted-history line.
 * Failures never throw: every error converges on a failure marker line.
 */
export async function transformNewAttachments(
  contextId: string,
  chatUserId: string,
  records: readonly StoredAttachment[],
): Promise<Map<string, TransformLine>> {
  const result = new Map<string, TransformLine>()
  if (records.length === 0) return result
  const transformers = collectContextTransformers(contextId)
  if (transformers.length === 0) return result

  for (const stored of records) {
    const record = toPluginRecord(stored)
    const matched = transformers.find((entry) => matchesTransformer(entry.transformer, record))
    if (matched === undefined) continue
    const runtimeContext = buildPluginToolRuntimeContext(matched.pluginId, matched.manifest, {
      storageContextId: contextId,
      chatUserId,
    })
    result.set(stored.attachmentId, await executeTransformer(matched.transformer, record, runtimeContext))
  }
  return result
}
```

Note: `contributions.attachmentTransformers` is the non-optional array added to `ActivePluginContributions` in Task 6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/plugins/attachment-transform.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/attachment-transform.ts tests/plugins/attachment-transform.test.ts
git commit -m "feat(plugins): attachment transformer dispatch, timeout isolation, and line rendering"
```

---

### Task 10: Turn assembly — transcript injection, audio part suppression, unified text

**Files:**

- Modify: `src/llm-orchestrator-attachments.ts`
- Test: `tests/llm-orchestrator-attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/llm-orchestrator-attachments.test.ts` (follow the file's existing S3-config + attachment fixture pattern):

```typescript
test('audio attachments never become file parts for multimodal models', async () => {
  // save an audio/ogg attachment, reference it via newAttachmentIds, modelName 'gpt-4o'
  const { modelMessage } = await buildUserTurnMessages('ctx-a', 'u1', 'gpt-4o', 'listen', [savedAudio.attachmentId])
  const parts = Array.isArray(modelMessage.content) ? modelMessage.content : []
  expect(parts.some((p) => p.type === 'file')).toBe(false)
})

test('multimodal text part includes the attachment lines', async () => {
  const { modelMessage } = await buildUserTurnMessages('ctx-a', 'u1', 'gpt-4o', 'see', [savedImage.attachmentId])
  const parts = Array.isArray(modelMessage.content) ? modelMessage.content : []
  const textPart = parts.find((p) => p.type === 'text')
  expect(textPart?.text).toContain(`[User attached ${savedImage.attachmentId}:`)
})

test('a transformed attachment renders its transcript line live and a truncated line in history', async () => {
  // requires an active plugin with a transformer; stub via the registry the same way
  // tests/plugins/attachment-transform.test.ts does, or activate a test plugin fixture.
  const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-v', 'u1', 'small-model', 'do it', [
    voiceAtt.attachmentId,
  ])
  expect(String(modelMessage.content)).toContain('Voice attachment')
  expect(String(historyMessage.content)).toContain('[User attached')
})
```

(If activating a real plugin in this suite is impractical, move the third test into `tests/plugins/attachment-transform.test.ts` as an integration of `transformNewAttachments` and assert here only the no-transformer pass-through: live and history lines both `[User attached …]`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/llm-orchestrator-attachments.test.ts`
Expected: FAIL — file part emitted for audio; multimodal text lacks attachment lines

- [ ] **Step 3: Implement**

In `src/llm-orchestrator-attachments.ts`:

1. `recordToPart` — add as the first check:

```typescript
// Audio bytes never reach the LLM as content parts; transcripts (when a
// transformer plugin is enabled) reach it as text lines instead.
if (record.mimeType !== undefined && record.mimeType.startsWith('audio/')) {
  return null
}
```

2. Rework the body of `buildUserTurnMessages` after `selectAttachmentsForTurn`:

```typescript
if (selected.length === 0) return textOnly()

const records = await loadAttachmentRecords(contextId, selected)
const newIds = new Set(newAttachmentIds)
const newRecords = records.filter((record) => newIds.has(record.attachmentId))
const transforms = await transformNewAttachments(contextId, chatUserId, newRecords)

const liveLines: string[] = []
const historyLines: string[] = []
for (const ref of selected) {
  const transformed = transforms.get(ref.attachmentId)
  if (transformed !== undefined) {
    liveLines.push(transformed.line)
    historyLines.push(transformed.historyLine)
  } else {
    const line = `[User attached ${ref.attachmentId}: ${ref.filename}]`
    liveLines.push(line)
    historyLines.push(line)
  }
}

const liveContent = `${timeTag}\n${liveLines.join('\n')}\n\n${text}`
const historyContent = `${timeTag}\n${historyLines.join('\n')}\n\n${text}`
const historyMessage: ModelMessage = { role: 'user', content: historyContent }

if (!supportsAttachmentModelInput(modelName)) {
  return { modelMessage: { role: 'user', content: liveContent } as ModelMessage, historyMessage }
}

const parts: AttachmentPart[] = []
for (const record of records) {
  const part = recordToPart(record)
  if (part !== null) parts.push(part)
}
parts.push({ type: 'text', text: liveContent })

return { modelMessage: { role: 'user', content: parts } as ModelMessage, historyMessage }
```

Import `transformNewAttachments` from `./plugins/attachment-transform.js`. The previous behavior of building `historyLines` via `buildHistoryAttachmentLines` is replaced by the loop above; remove the now-unused import if nothing else uses it in this file. Keep `loadAttachmentRecords` as-is (it now also serves the text-only path).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/llm-orchestrator-attachments.test.ts tests/plugins/ && bun typecheck`
Expected: PASS (existing suite assertions about history lines still hold — the pass-through line format is unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-attachments.ts tests/llm-orchestrator-attachments.test.ts
git commit -m "feat(orchestrator): pre-turn attachment transforms, audio part suppression, unified turn text"
```

---

### Task 11: Group eager-resolve for voice staged files

**Files:**

- Modify: `src/bot-attachments.ts`
- Modify: `src/bot.ts:143-155` (handleMessage)
- Test: `tests/bot-attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/bot-attachments.test.ts`:

```typescript
test('resolveVoiceStagedFiles resolves only voice-origin staged files for the message', async () => {
  stageFileMetadata({
    contextId: 'ctx-g',
    messageId: 'm-9',
    senderId: 'u1',
    senderUsername: null,
    filename: 'voice.ogg',
    mimeType: 'audio/ogg',
    size: 4,
    platformFileId: 'pf-v',
    sourceProvider: 'telegram',
    sourcePlatformInstanceId: 'pi',
    origin: 'voice',
    forwardedFrom: null,
  })
  stageFileMetadata({
    contextId: 'ctx-g',
    messageId: 'm-9',
    senderId: 'u1',
    senderUsername: null,
    filename: 'doc.pdf',
    mimeType: 'application/pdf',
    size: 4,
    platformFileId: 'pf-d',
    sourceProvider: 'telegram',
    sourcePlatformInstanceId: 'pi',
    origin: null,
    forwardedFrom: null,
  })
  const ids = await resolveVoiceStagedFiles('ctx-g', 'm-9', async () => Buffer.from('audio'))
  expect(ids).toHaveLength(1)
  const stored = await loadAttachmentRecord('ctx-g', ids[0]!)
  expect(stored?.origin).toBe('voice')
})

test('resolveVoiceStagedFiles returns empty without messageId or downloadFn', async () => {
  expect(await resolveVoiceStagedFiles('ctx-g', undefined, async () => null)).toEqual([])
  expect(await resolveVoiceStagedFiles('ctx-g', 'm-9', undefined)).toEqual([])
})

test('resolveVoiceStagedFiles tolerates a failing download', async () => {
  stageFileMetadata({
    contextId: 'ctx-g2',
    messageId: 'm-1',
    senderId: 'u1',
    senderUsername: null,
    filename: 'voice.ogg',
    mimeType: 'audio/ogg',
    size: 4,
    platformFileId: 'pf-x',
    sourceProvider: 'telegram',
    sourcePlatformInstanceId: 'pi',
    origin: 'voice',
    forwardedFrom: null,
  })
  const ids = await resolveVoiceStagedFiles('ctx-g2', 'm-1', async () => null)
  expect(ids).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bot-attachments.test.ts`
Expected: FAIL — `resolveVoiceStagedFiles` is not exported

- [ ] **Step 3: Implement**

`src/bot-attachments.ts` — add (importing `findStagedFilesByMessageId`, `resolveStagedFile` from `./attachments/index.js` — re-export them there if not already, and `StagedFileDownloadFn` from `./attachments/types.js`):

```typescript
/**
 * Eagerly resolve voice-origin staged files for the message being processed.
 * Group chats stage files lazily; a voice note addressed to the bot IS the
 * message, so it must be available before the LLM turn starts. Ordinary
 * staged files keep lazy resolution via the resolve_staged_file tool.
 */
export async function resolveVoiceStagedFiles(
  storageContextId: string,
  messageId: string | undefined,
  downloadFn: StagedFileDownloadFn | undefined,
): Promise<string[]> {
  if (!isS3Configured() || messageId === undefined || downloadFn === undefined) return []
  const voiceStaged = findStagedFilesByMessageId(storageContextId, messageId).filter(
    (staged) => staged.origin === 'voice',
  )
  const attachmentIds: string[] = []
  for (const staged of voiceStaged) {
    const result = await resolveStagedFile(staged.stagedId, storageContextId, downloadFn)
    if ('attachmentId' in result && result.attachmentId !== null && result.attachmentId !== 'unknown') {
      attachmentIds.push(result.attachmentId)
    } else {
      log.warn({ stagedId: staged.stagedId, storageContextId }, 'Eager voice staged-file resolution failed')
    }
  }
  return attachmentIds
}
```

(Note: `resolveStagedFile` returns `AttachmentRef | StagedResolutionError`; both `AttachmentRef` and the `already_resolved` error expose `attachmentId`, which is exactly what we want — an already-resolved voice note still joins the turn. The `'unknown'` sentinel from a corrupt `already_resolved` row is filtered.)

`src/bot.ts` — in `handleMessage`, resolve voice staged files (they were staged by `tryStageGroupCandidates` in `onIncomingMessage`, which runs before `handleMessage`) and merge:

```typescript
  if (shouldIgnoreGroupMessage(msg)) return
  const voiceAttachmentIds = await resolveVoiceStagedFiles(auth.storageContextId, msg.messageId, deps.stagedDownloadFn)
  const { newAttachmentIds, activeAttachments } = await resolveMessageAttachments(chat, msg, auth.storageContextId)
  ...
      newAttachmentIds: [...voiceAttachmentIds, ...newAttachmentIds],
```

(import `resolveVoiceStagedFiles` alongside the existing `resolveMessageAttachments` import; `resolveVoiceStagedFiles` runs BEFORE `resolveMessageAttachments` so the resolved attachment appears in `activeAttachments` and therefore in the prompt's attachment manifest.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bot-attachments.test.ts tests/bot.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot-attachments.ts src/bot.ts tests/bot-attachments.test.ts
git commit -m "feat(bot): eagerly resolve voice-origin staged files before the turn"
```

---

### Task 12: audio-transcribe plugin v2

**Files:**

- Modify: `plugins/audio-transcribe/plugin.json`
- Modify: `plugins/audio-transcribe/index.ts`
- Test: `tests/plugins/audio-transcribe.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend `tests/plugins/audio-transcribe.test.ts` (keep the existing 12 tests; the runtime-context mock gains `contextConfig` — added in Task 7 — and the new tests below):

```typescript
test('registers the attachment transformer', () => {
  const { ctx, registeredTransformer } = createMockContext()
  factory().activate(ctx)
  expect(registeredTransformer.value?.name).toBe('audio-transcribe')
  expect(registeredTransformer.value?.origins).toEqual(['voice'])
})

test('transform returns ok text via the shared pipeline', async () => {
  const { transformer, runtimeContext } = setupTransformer({ apiKeySource: 'admin' })
  const result = await transformer.transform(makeVoiceRecord(), runtimeContext)
  expect(result).toEqual({ ok: true, text: 'Hello world', meta: { language: 'en' } })
})

test('transform reports not configured when no key is set anywhere', async () => {
  const { transformer, runtimeContext } = setupTransformer({ apiKeySource: 'none' })
  const result = await transformer.transform(makeVoiceRecord(), runtimeContext)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('not configured')
})

test('context api_key overrides admin api_key at execute time', async () => {
  const seenAuth: string[] = []
  const { transformer, runtimeContext } = setupTransformer({
    apiKeySource: 'both',
    onFetch: (init) => seenAuth.push(String(new Headers(init?.headers).get('Authorization'))),
  })
  await transformer.transform(makeVoiceRecord(), runtimeContext)
  expect(seenAuth[0]).toBe('Bearer ctx-key')
})

test('tool accepts a MIME-less attachment with a known audio extension', async () => {
  // attachments.read returns record with mimeType undefined, filename 'note.m4a'
  const result = await executeTool(
    { attachment_id: 'att_1' },
    { record: { mimeType: undefined, filename: 'note.m4a' } },
  )
  expect(result).toEqual({ ok: true, text: 'Hello world', meta: { language: 'en' } })
})

test('cache write prunes entries older than 30 days', async () => {
  const kvBacking = new Map<string, string>()
  const old = JSON.stringify({ text: 'old', cachedAt: '2020-01-01T00:00:00.000Z' })
  kvBacking.set('transcript:att_old', old)
  await executeToolWithKv({ attachment_id: 'att_new' }, kvBacking)
  expect(kvBacking.has('transcript:att_old')).toBe(false)
  expect(kvBacking.has('transcript:att_new')).toBe(true)
})
```

Build `setupTransformer`/`executeTool`/`executeToolWithKv` helpers on the file's existing `createMockContext`/`createMockRuntimeContext`/`createMockAttachments` foundations: capture the registered transformer the same way `registeredTool` is captured; `apiKeySource` controls whether `adminConfig.get('api_key')`/`contextConfig.get('api_key')` return values (`'admin'` → admin only, `'both'` → admin `admin-key` + context `ctx-key`, `'none'` → neither); the mock `httpFetch` keeps returning `{ text: 'Hello world', language: 'en' }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/audio-transcribe.test.ts`
Expected: FAIL — no transformer registered; config still read at activation

- [ ] **Step 3: Implement plugin v2**

`plugins/audio-transcribe/plugin.json`:

```json
{
  "id": "audio-transcribe",
  "name": "Audio Transcribe",
  "version": "2.0.0",
  "description": "Transcribes voice notes automatically before the LLM turn and audio attachments on demand via an OpenAI-compatible /v1/audio/transcriptions API",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": ["transcribe"],
    "promptFragments": ["audio-transcribe-hint"],
    "attachmentTransformers": ["audio-transcribe"]
  },
  "permissions": ["http", "attachments.read", "storage"],
  "providerAllowedHosts": ["api.openai.com", "api.groq.com"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "api_key", "label": "Transcription API Key", "required": false, "sensitive": true, "scope": "admin" },
    { "key": "base_url", "label": "Base URL", "required": false, "sensitive": false, "scope": "admin" },
    { "key": "model", "label": "Model", "required": false, "sensitive": false, "scope": "admin" },
    {
      "key": "api_key",
      "label": "Transcription API Key (context override)",
      "required": false,
      "sensitive": true,
      "scope": "context"
    },
    { "key": "model", "label": "Model (context override)", "required": false, "sensitive": false, "scope": "context" }
  ],
  "activationTimeoutMs": 3000
}
```

**Schema check:** if `pluginManifestSchema` rejects duplicate `configRequirements` keys across scopes (verify with a quick test or by reading the schema), rename the context entries to `api_key` is preferred — in that case relax the uniqueness check to be per-(key, scope) in `src/plugins/types.ts` as part of this task, with a manifest-schema test for it.

`plugins/audio-transcribe/index.ts` — rework (keeping `normalizeBaseUrl`, `normalizeModel`, `buildMultipartBody`, `callTranscriptionApi`, schemas, and constants as-is):

1. Config resolution moves to execute time:

```typescript
type ResolvedConfig = { apiKey: string | undefined; baseUrl: string; model: string }

const resolveConfig = (runtimeContext: PluginToolRuntimeContext): ResolvedConfig => ({
  apiKey: runtimeContext.contextConfig.get('api_key') ?? runtimeContext.adminConfig.get('api_key'),
  baseUrl: normalizeBaseUrl(runtimeContext.adminConfig.get('base_url')),
  model: runtimeContext.contextConfig.get('model') ?? normalizeModel(runtimeContext.adminConfig.get('model')),
})
```

2. Audio acceptance with extension fallback (shared by tool and transformer):

```typescript
const AUDIO_EXTENSIONS = ['.ogg', '.opus', '.mp3', '.m4a', '.wav', '.webm'] as const

const isAudioRecord = (record: Pick<PluginAttachmentRecord, 'mimeType' | 'filename'>): boolean => {
  if (record.mimeType !== undefined) return record.mimeType.startsWith('audio/')
  const lower = record.filename.toLowerCase()
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
```

Replace the MIME check inside `loadAudioAttachment` with `if (!isAudioRecord(record)) return { ok: false, result: { error: 'unsupported_media_type', mimeType: record.mimeType ?? null } }`.

3. Cache entries gain `cachedAt` + opportunistic pruning:

```typescript
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const cachedSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  durationSec: z.number().optional(),
  cachedAt: z.string().optional(),
})

function pruneOldTranscripts(kv: PluginToolRuntimeContext['kv'], now: number): void {
  for (const entry of kv.list('transcript:')) {
    try {
      const parsed = cachedSchema.safeParse(JSON.parse(entry.value))
      const cachedAt = parsed.success ? parsed.data.cachedAt : undefined
      if (cachedAt === undefined || now - Date.parse(cachedAt) > CACHE_MAX_AGE_MS) kv.delete(entry.key)
    } catch {
      kv.delete(entry.key)
    }
  }
}
```

On cache write: `kv.set(cacheKey, JSON.stringify({ ...apiResult, cachedAt: new Date().toISOString() }))` followed by `pruneOldTranscripts(kv, Date.now())`, both inside the existing try/catch. (Prune only deletes entries older than the max age or unparseable ones — the just-written entry survives.)

4. One shared transcription function used by both surfaces:

```typescript
async function transcribeRecord(
  record: PluginAttachmentRecord,
  bytes: Buffer,
  language: string | undefined,
  runtimeContext: PluginToolRuntimeContext,
  httpFetch: HttpFetch | undefined,
): Promise<TranscribeResult | { error: string; status?: number; message?: string }> {
  const { apiKey, baseUrl, model } = resolveConfig(runtimeContext)
  if (apiKey === undefined || apiKey.trim() === '' || httpFetch === undefined) {
    return { error: 'not_configured', message: 'audio-transcribe: api_key missing or providerRuntime unavailable' }
  }
  const body = buildMultipartBody(record, bytes, model, language)
  return callTranscriptionApi(httpFetch, baseUrl, apiKey, body)
}
```

(`type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>`.) `executeTranscribe` (the tool path) keeps its rate-limit check, input parsing, cache read, `loadAudioAttachment`, then delegates to `transcribeRecord` and writes the cache. The `apiKey`/`baseUrl`/`model` parameters and the activation-time closure reads are removed; only `httpFetch` stays captured at activation (it is a frozen runtime facade, not config).

5. The transformer, registered in `activate()`:

```typescript
ctx.registration.registerAttachmentTransformer({
  name: 'audio-transcribe',
  mimePrefixes: ['audio/'],
  filenameExtensions: [...AUDIO_EXTENSIONS],
  origins: ['voice'],
  timeoutMs: 60_000,
  async transform(record, runtimeContext) {
    const cacheKey = `transcript:${record.attachmentId}`
    const cached = readCachedTranscript(runtimeContext.kv, cacheKey)
    if (cached !== undefined) return toTransformResult(cached)

    const rateResult = runtimeContext.rateLimit.check(runtimeContext.storageContextId)
    if (!rateResult.allowed) return { ok: false, reason: 'rate limited — try again shortly' }

    const audio = await loadAudioAttachment(runtimeContext, record.attachmentId)
    if (!audio.ok) return { ok: false, reason: describeLoadFailure(audio.result) }

    const apiResult = await transcribeRecord(audio.record, audio.bytes, undefined, runtimeContext, httpFetch)
    if ('error' in apiResult) return { ok: false, reason: describeApiFailure(apiResult) }

    writeCache(runtimeContext.kv, cacheKey, apiResult)
    return toTransformResult(apiResult)
  },
})
```

with the small helpers:

```typescript
const toTransformResult = (
  result: TranscribeResult,
): { ok: true; text: string; meta?: { language?: string; durationSec?: number } } => ({
  ok: true,
  text: result.text,
  ...(result.language === undefined && result.durationSec === undefined
    ? {}
    : {
        meta: {
          ...(result.language === undefined ? {} : { language: result.language }),
          ...(result.durationSec === undefined ? {} : { durationSec: result.durationSec }),
        },
      }),
})

const describeLoadFailure = (result: unknown): string => {
  const error = typeof result === 'object' && result !== null && 'error' in result ? String(result.error) : 'unknown'
  if (error === 'audio_too_large') return 'file too large (max 24 MiB)'
  if (error === 'not_configured') return 'not configured — the admin can set a transcription API key in the settings UI'
  if (error === 'attachment_not_found') return 'attachment not found'
  if (error === 'unsupported_media_type') return 'unsupported media type'
  return 'transcription service error'
}

const describeApiFailure = (result: { error: string }): string =>
  result.error === 'not_configured'
    ? 'not configured — the admin can set a transcription API key in the settings UI'
    : 'transcription service error'

const writeCache = (kv: PluginToolRuntimeContext['kv'], cacheKey: string, result: TranscribeResult): void => {
  try {
    kv.set(cacheKey, JSON.stringify({ ...result, cachedAt: new Date().toISOString() }))
    pruneOldTranscripts(kv, Date.now())
  } catch {
    // KV may be denied; caching is best-effort.
  }
}
```

(Refactor `executeTranscribe` to use `writeCache` too, so the cache shape is identical for both surfaces.)

6. Rewrite the prompt fragment:

```typescript
ctx.registration.registerPromptFragment({
  name: 'audio-transcribe-hint',
  content:
    'Voice notes are transcribed automatically: their text appears inline as `[Voice attachment att_<id> …: "…"]` lines. Call the transcribe tool only when (a) the user asks to transcribe an audio FILE attachment (lines like `[User attached att_<id>: song.mp3]`), or (b) a transcript is clearly wrong and the user names the spoken language — then pass `language`. Cached transcripts make repeat calls free.',
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/plugins/audio-transcribe.test.ts tests/plugins/ && bun typecheck && bun lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/audio-transcribe/ tests/plugins/audio-transcribe.test.ts src/plugins/types.ts tests/plugins/manifest-schema.test.ts
git commit -m "feat(plugins): audio-transcribe v2 — voice transformer, execute-time config, cache pruning"
```

---

### Task 13: Documentation, supersede notes, and ADR

**Files:**

- Modify: `docs/plugins/developer-guide.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-04-11-audio-message-transcription-design.md` (status header only)
- Modify: `docs/superpowers/plans/2026-04-11-audio-message-transcription-implementation.md` (status header only)
- Create: `docs/adr/NNNN-attachment-transformer-plugin-hook.md` (next free number — check `ls docs/adr/ | sort | tail -3`)

- [ ] **Step 1: Update the developer guide**

In `docs/plugins/developer-guide.md`:

- Add `contributes.attachmentTransformers` to the manifest field table: "Attachment transformer names the plugin may register with `ctx.registration.registerAttachmentTransformer()`. Requires the `attachments.read` permission. Transformers run before the LLM turn for matching new attachments and return text the core renders into the prompt."
- Add `providerAllowedHostsFromConfig` to the table: "Admin-scoped config keys whose values contribute their host to the HTTP allowlist at call time. Hosts contributed this way are operator-trusted and skip the https/public-IP restrictions that static `providerAllowedHosts` enforce."
- In the tool-runtime-context paragraph add: "`runtimeContext.contextConfig.get(key)` resolves context-scoped `configRequirements` values; attachment records expose `origin` ('voice' for voice notes) and `forwardedFrom`."
- Add a short "Attachment Transformers" section documenting the registration shape (`name`, `mimePrefixes`, `filenameExtensions`, `origins`, `timeoutMs`, `transform(record, runtimeContext)`), the result union, that core owns formatting, and that failures render as marker lines and never block the turn.

- [ ] **Step 2: Update CLAUDE.md**

In the Plugin System section: extend the context-facade bullet with `registerAttachmentTransformer` and `contextConfig`, and add one bullet: "**Attachment transformers** — plugins can pre-process new attachments before the LLM turn (e.g., `audio-transcribe` transcribes voice notes); dispatch is MIME/extension/origin-filtered, eligibility-aware, timeout-isolated, and failures become in-turn marker lines."

- [ ] **Step 3: Mark old docs superseded**

At the top of both 2026-04-11 documents change the status line and add:

```markdown
**Status:** Superseded by `docs/superpowers/specs/2026-06-12-audio-transcribe-ux-fixes-design.md`
```

- [ ] **Step 4: Write the ADR**

Create `docs/adr/NNNN-attachment-transformer-plugin-hook.md` following the format of the most recent ADR in the directory. Content outline (write it in full, following neighboring ADRs' style): Context — the 2026-04-11 STT design was implemented as a plugin tool instead of a core module; verification found deterministic-UX, multimodal, config-freshness, and endpoint-trust gaps. Decision — (1) generic `attachmentTransformers` plugin contribution dispatched pre-turn from `buildUserTurnMessages`; (2) attachment `origin`/`forwarded_from` columns; (3) eager resolution of voice-origin staged files; (4) execute-time plugin config with context overrides; (5) `providerAllowedHostsFromConfig` for admin-trusted endpoints; (6) `audio/*` content parts suppressed. Consequences — voice notes transcribe deterministically on all platforms with file pipelines; audio files stay tool-driven; plugin approval is cleared by the manifest change and must be re-granted after deploy.

- [ ] **Step 5: Format, verify, commit**

```bash
bun format && bun lint
git add docs/ CLAUDE.md
git commit -m "docs: attachment transformer hook — guide, ADR, supersede 2026-04-11 STT docs"
```

---

### Task 14: Final verification

- [ ] **Step 1: Full test suite**

Run: `bun build:client && bun run test`
Expected: all suites PASS

- [ ] **Step 2: Full checks**

Run: `bun typecheck && bun lint && bun format:check && bun knip`
Expected: all PASS (if knip flags new exports such as `executeTransformer` or `matchesTransformer`, they are test-consumed — prefer narrowing exports over ignore entries; only extend `knip.jsonc` for genuinely dynamic-loaded surfaces)

- [ ] **Step 3: Client/E2E sanity**

Run: `bun test:client`
Expected: PASS (settings UI consumes `configRequirements` generically; the new context-scoped entries appear without code changes — verify no snapshot test breaks)

- [ ] **Step 4: Commit any stragglers and wrap up**

```bash
git status --short
git commit -am "chore: final verification fixes for audio-transcribe UX work" # only if needed
```

Operational reminder for the deployer (include in the PR description): the `audio-transcribe` manifest change clears plugin approval by design — re-approve it in the settings UI admin Plugins area after deploying, and re-enable per context if needed.

---

## Self-Review

### Spec coverage

| Spec section                                                                             | Task(s)                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| §1 Scenario policy (voice DM / voice group / forwarded / audio files)                    | 3, 4, 9 (origins filter), 11, 12                          |
| §2 Origin signal + persistence (migration, adapters, staged)                             | 1, 2, 3, 4                                                |
| §3 Transformer plugin API (manifest, registration, contextConfig, record fields)         | 5, 6, 7                                                   |
| §4 Turn assembly (dispatch, rendering, multimodal fix, history truncation)               | 9, 10                                                     |
| §4 Group eager-resolve                                                                   | 11                                                        |
| §5 Plugin v2 (config resolution, shared internals, cache prune, fragment, MIME fallback) | 12                                                        |
| §6 providerAllowedHostsFromConfig                                                        | 5 (schema), 8 (runtime)                                   |
| §7 Error handling table                                                                  | 9 (timeout/exception), 12 (reason strings)                |
| Testing section                                                                          | every task carries its tests; Task 14 runs the full suite |
| Docs & rollout                                                                           | 13, 14                                                    |

### Known judgment calls (documented, not placeholders)

- Discord is scoped out: its adapter has no file extraction at all today, so there is nothing to tag (plan header note).
- Duplicate `configRequirements` keys across scopes may need a schema relaxation — Task 12 Step 3 carries the contingency with its own test requirement.
- Dynamic hosts skip the https requirement as well as the public-IP check (LAN endpoints rarely have TLS); encoded and tested in Task 8.
