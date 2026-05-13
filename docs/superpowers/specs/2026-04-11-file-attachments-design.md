# File Attachments Design: Shared Attachment Pipeline

**Date:** 2026-04-11  
**Updated:** 2026-04-25 — switched the blob backend from on-disk storage to S3-compatible object storage (Bun's built-in `Bun.S3Client`). The runtime now requires an S3-compatible bucket; persistence semantics, history-safety, and the `AttachmentRef`/`StoredAttachment` shape are unchanged.  
**Status:** Approved  
**Scope:** Platform-agnostic attachment ingestion, durable attachment persistence, LLM-visible files, tool-visible files, and migration away from transient current-turn relay state

## Problem Statement

papai already has partial incoming-file support, but it is split across several layers and only one of the main use cases is fully wired today.

1. **Telegram and Mattermost already ingest incoming files** into `IncomingMessage.files`, and the bot already carries those files through queueing.
2. **Tool usage exists, but only for the current turn**. `upload_attachment` depends on the transient in-memory `file-relay` and exposes platform `fileId` values in prompt text.
3. **LLM usage does not exist yet**. `llm-orchestrator.ts` still sends string-only user messages and never hydrates attachments into `ImagePart` or `FilePart`.
4. **History cannot safely hold binary content**. Conversation history is stored as JSON text, and trim/summarization logic assumes text-first messages.
5. **The design must fit the provider-capability-architecture migration**. Telegram, Mattermost, and future Discord support should converge on a shared contract instead of adding more provider-name branches.

The result is an awkward split: chat adapters own file bytes, the prompt builder only exposes metadata, tools only see the latest turn, and the LLM cannot reason over the files themselves.

## Goals

1. Make incoming attachments first-class for both **LLM understanding** and **tool workflows**.
2. Define a **platform-agnostic attachment contract** that Telegram and Mattermost can adopt first and Discord can adopt later.
3. Persist attachments **until the user clears them**.
4. Keep attachment persistence **separate from conversation history** so history stays text-safe and trim-safe.
5. Align the design with the existing **capability-shaped provider architecture**.
6. Support graceful degradation when file download, persistence, or model attachment support fails.

## Non-Goals

- Building a rich attachment-management UI in the first pass.
- Automatically re-sending every stored attachment to the model on every turn.
- Backfilling old history rows into the new attachment workspace.
- Requiring Discord implementation in the first pass; Discord is a compatibility target, not a delivery requirement.
- Implementing CDN delivery, signed-URL handoff, multipart uploads, server-side encryption keys, or lifecycle policies. The first pass uses straight `PutObject`/`GetObject`/`DeleteObject` semantics against an S3-compatible bucket.

## Current State

The approved design starts from the real codebase state, not from the older research assumptions.

| Area          | Current reality                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Chat contract | `IncomingMessage.files` and `IncomingFile` already exist in `src/chat/types.ts`.                                        |
| Telegram      | `src/chat/telegram/index.ts` and `file-helpers.ts` already download incoming document/photo/audio/video/voice files.    |
| Mattermost    | `src/chat/mattermost/index.ts` and `file-helpers.ts` already fetch metadata and bytes for `file_ids`.                   |
| Bot flow      | `src/bot.ts` already queues files and stores them in `file-relay.ts` before calling the LLM.                            |
| Prompting     | `buildPromptWithReplyContext()` only exposes attachment metadata and transient `fileId` values.                         |
| Tools         | `upload_attachment` can upload a file from the current message only, using `file-relay.ts` as the source of truth.      |
| LLM           | `processMessage()` and `llm-orchestrator.ts` are string-only.                                                           |
| History       | Conversation history is persisted as JSON text and should remain binary-free.                                           |
| Discord       | The provider advertises `files.receive`, but `mapDiscordMessage()` does not yet map attachments into `IncomingMessage`. |

That means the design problem is not "how do we add incoming files at all?" but rather "how do we turn today's fragmented file path into a shared attachment pipeline?"

## Design

### 1. Shared Attachment Subsystem

Add a new `src/attachments/` module that owns attachment persistence and lookup for the rest of the application.

```text
src/
├── attachments/
│   ├── types.ts
│   ├── ingest.ts
│   ├── store.ts
│   ├── workspace.ts
│   ├── resolver.ts
│   └── blob-store.ts
```

| Component                 | Responsibility                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AttachmentIngestService` | Accept raw incoming files from chat adapters, normalize metadata, persist content, and return stable attachment refs.     |
| `AttachmentStore`         | Own metadata persistence and coordinate blob reads/writes through `BlobStore`.                                            |
| `AttachmentWorkspace`     | Track stored attachments and the active attachment set for each conversation context.                                     |
| `AttachmentResolver`      | Convert attachment refs into LLM parts, tool inputs, or text placeholders depending on runtime support and failure state. |
| `BlobStore`               | Thin abstraction over the S3-compatible bucket. Runtime: `Bun.S3Client`-backed. Tests: in-memory implementation.          |

This is the key boundary shift:

- **Chat providers** receive platform files.
- **Attachments module** becomes the durable source of truth.
- **Bot and queue** operate on attachment refs instead of raw buffers after ingestion.
- **LLM and tools** consume the same shared refs.

### 2. Data Model

Introduce a stable papai-level attachment identity that replaces platform `fileId` as the long-lived identifier.

```typescript
type AttachmentRef = {
  attachmentId: string
  contextId: string
  filename: string
  mimeType?: string
  size?: number
  status: 'available' | 'tool_only' | 'rejected' | 'unavailable'
}

type StoredAttachment = AttachmentRef & {
  sourceMessageId?: string
  sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown'
  sourceFileId?: string
  checksum: string
  blobKey: string // object key inside the configured S3 bucket
  createdAt: string
  clearedAt?: string
  lastUsedAt?: string
}
```

`AttachmentRef` is safe to surface in prompts, queues, and history placeholders. `StoredAttachment` stays internal to the attachment subsystem.

### 3. Attachment Workspace Model

Each storage context gets an **attachment workspace** with two layers:

1. **Stored attachments** - every attachment persisted for that context until cleared.
2. **Active attachment set** - the attachments the bot should treat as currently in play.

Behavior:

- Newly received attachments are stored immediately and added to the active set.
- The active set persists across turns.
- Later turns do **not** automatically rehydrate every stored file into model input.
- Instead, later turns see a compact manifest of active attachments, and the resolver hydrates only the attachments relevant for that turn.

This preserves the user expectation of "keep the files around until I clear them" without turning every future LLM call into an unbounded multimodal replay.

### 4. Persistence Model

Persist attachment metadata in SQLite and persist binary content in an S3-compatible object store.

| Storage layer        | Contents                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQLite               | `attachmentId`, `contextId`, provider/source metadata, filename, mime type, size, checksum, timestamps, status, active/cleared state             |
| S3-compatible bucket | Raw attachment bytes addressed by stable object key (derived from attachment ID); checksum is stored for integrity checks and future dedupe work |
| Conversation history | Text placeholders and attachment refs only, never raw bytes                                                                                      |

This keeps history and trim logic safe:

- No `Uint8Array` or base64 payloads in conversation JSON
- No binary blobs in trim prompts
- No need to serialize `ImagePart` or `FilePart` back into history storage

#### 4.1. Why S3-Compatible Storage

The bot already runs on Bun, and Bun ships with a first-party `Bun.S3Client` API. Using S3-compatible storage instead of local disk gives us:

- **Operational portability** — the bot can run in stateless containers without a persistent volume; attachments survive restarts and redeploys.
- **Provider flexibility** — the same code works against AWS S3, Cloudflare R2, MinIO, Backblaze B2, Garage, SeaweedFS, and any other endpoint that speaks the S3 API.
- **No new dependencies** — Bun's built-in client avoids pulling in the multi-megabyte AWS SDK.
- **Forward path** — the same bucket can later host signed-URL delivery, lifecycle expiration, and dedupe-by-checksum without another data migration.

#### 4.2. Object Layout

Object keys live under an optional configurable prefix and are derived from the stable papai attachment ID:

```text
<S3_PREFIX?>/<contextId>/<attachmentId>
```

- The `contextId` segment is informational only — `attachmentId` is globally unique by itself, but grouping by context keeps debugging readable and makes future per-context bucket policies straightforward.
- All bytes are written with the original `mimeType` (when known) as the `Content-Type` header, and a `Content-Length` matching the `size` column.
- Object keys are computed from the attachment ID alone, never from filenames, so ingestion is safe against path-traversal-style filenames.

#### 4.3. Blob Store Abstraction

The attachment subsystem talks to an internal `BlobStore` interface, not to `Bun.S3Client` directly:

```typescript
interface BlobStore {
  put(key: string, content: Buffer, contentType?: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  deleteMany(keys: readonly string[]): Promise<void>
}
```

The runtime implementation wraps `Bun.S3Client`. Tests inject an in-memory implementation through DI. This keeps the unit test loop fast and avoids requiring a running MinIO during `bun test`.

#### 4.4. Configuration

The runtime reads S3 credentials from environment variables and treats them like any other piece of infrastructure config:

| Variable               | Purpose                                                             | Required |
| ---------------------- | ------------------------------------------------------------------- | -------- |
| `S3_BUCKET`            | Bucket name where attachment objects live                           | yes      |
| `S3_ENDPOINT`          | Endpoint URL (omit for AWS, set for R2/MinIO/B2/etc.)               | no       |
| `S3_REGION`            | Region — required by AWS, optional for most S3-compatible providers | no       |
| `S3_ACCESS_KEY_ID`     | Access key                                                          | yes      |
| `S3_SECRET_ACCESS_KEY` | Secret key                                                          | yes      |
| `S3_PREFIX`            | Optional key prefix so multiple environments can share a bucket     | no       |
| `S3_FORCE_PATH_STYLE`  | `'true'` for MinIO and other path-style providers                   | no       |

`S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` are validated at startup; the runtime fails fast if any are missing. `bun start:debug` documents the expected variables. Credentials never enter the SQLite database.

#### 4.5. Failure Semantics

S3 outages must not silently swallow attachments. The store treats backend errors as first-class failures:

- A failed `PUT` during ingest marks the attachment `unavailable` in SQLite and surfaces a per-file failure in the manifest, instead of pretending the file is fine.
- A `404 NoSuchKey` on later read returns an explicit "missing blob" error to the caller — the workspace metadata is the source of truth for "should this file exist", and a missing object signals data loss for that file only.
- `DELETE` failures during `/clear` are logged and surfaced; SQLite cleanup still proceeds so the user is not stuck with phantom workspace state, but the operator gets a warning to investigate orphaned objects.

### 5. Intake and Queue Flow

The queue should stop being the first durable owner of attachment bytes.

New flow:

1. Chat adapter receives message and downloads platform bytes into `IncomingFile`.
2. Bot intake persists those files immediately through `AttachmentIngestService`.
3. Queue stores `attachmentId[]` alongside queued text, not raw buffers.
4. Coalescing merges text and attachment refs from rapid-fire messages in the same context.
5. LLM processing resolves attachment refs on demand.

This moves persistence ahead of debounce and ahead of the LLM call, which is important because the user explicitly wants attachments to survive until clear.

### 6. Prompt and History Behavior

`buildPromptWithReplyContext()` should stop surfacing transient platform IDs like:

```text
[Attached files available for upload_attachment (use fileId): ...]
```

Instead, it should render a compact attachment manifest using papai attachment refs:

```text
[Available attachments: att_123 design.pdf (application/pdf), att_124 screenshot.jpg (image/jpeg)]
```

History storage should use placeholder text plus attachment refs, for example:

```text
[User attached att_123: design.pdf]
```

The placeholder is the persisted history representation. The actual bytes stay in the attachment workspace.

### 7. LLM Integration

`processMessage()` and the orchestrator should move from a string-only input to a structured turn input that can include text plus attachment refs.

Conceptually:

```typescript
type ProcessMessageInput = {
  text: string
  attachmentIds: string[]
}
```

Resolver outcomes:

| Outcome         | Behavior                                                                            |
| --------------- | ----------------------------------------------------------------------------------- |
| `model + tool`  | Hydrate the ref into `ImagePart` or `FilePart` and keep the ref available to tools. |
| `tool_only`     | Keep the attachment in workspace and surface a text placeholder to the model.       |
| `metadata_only` | Attachment could not be downloaded/persisted; surface failure metadata only.        |

Rules:

- Images become `ImagePart` when model support is available.
- Documents and other files become `FilePart` when supported.
- Unknown model attachment capability defaults to `tool_only`; do not optimistically send binary parts to unclassified models.
- Unsupported or risky cases fall back to text placeholders instead of failing the whole turn.
- The LLM receives only the attachment content chosen for the current turn, not every stored file in the workspace.

### 8. Tool Integration

Tools should resolve attachments through the shared attachment workspace instead of the transient `file-relay`.

#### `upload_attachment`

Change the long-lived interface from platform `fileId` to papai `attachmentId`:

```typescript
inputSchema: z.object({
  taskId: z.string(),
  attachmentId: z.string(),
})
```

Behavior:

- Load attachment bytes from the workspace by `attachmentId`
- Upload through the capability-gated task provider attachment API
- Return a clear error if the attachment was cleared or unavailable

#### Migration behavior

To reduce churn during rollout:

- adapters may still emit `IncomingFile`
- `file-relay.ts` can remain temporarily as a compatibility shim
- once all tool paths resolve `attachmentId` from the attachment workspace, `file-relay.ts` should be removed

### 9. Clear Behavior

In v1, `/clear` should clear the attachment workspace along with conversation history and memory for the same storage context.

This satisfies the user requirement that attachments remain available until the user clears them, without forcing a second management surface into the initial rollout.

Deferred:

- selective attachment removal
- attachment listing commands
- pin/unpin controls distinct from the active set

### 10. Capability Alignment

This design must not add new provider-name branching.

Alignment rules:

- **Chat providers** continue to advertise `files.receive`.
- **Telegram and Mattermost** become the first concrete implementations of the shared ingest contract.
- **Discord** implements the same ingest contract later instead of creating a separate downstream path.
- **Task provider upload behavior** stays capability-gated via `attachments.upload`.

This keeps the architecture consistent with the existing provider-capability migration: provider surfaces declare what they can do, and the rest of the app consumes normalized behavior.

### 11. Error Handling and Degradation

Attachment failure handling is **per file**, not all-or-nothing per message.

| Scenario                          | Behavior                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Download failure                  | Mark the attachment `unavailable`, continue with text and remaining attachments                   |
| File too large                    | Mark the attachment `rejected`, surface the reason in the manifest                                |
| S3 PUT failure during ingest      | Mark the attachment `unavailable`, surface metadata-only failure state and continue the turn      |
| S3 GET 404 on later read          | Return an explicit "missing blob" error for that attachment, do not fail unrelated attachments    |
| S3 DELETE failure during `/clear` | Log + warn the operator, but still drop SQLite metadata so the user is not stuck on phantom state |
| Unsupported model attachment type | Downgrade to `tool_only` placeholder behavior                                                     |

This keeps the system honest and resilient without hiding failures behind silent fallbacks.

### 12. Testing Strategy

The design needs explicit coverage at four levels.

1. **Attachment service unit tests**
   - ingest
   - clear behavior
   - metadata/blob consistency
   - active-set behavior
2. **Prompt and orchestrator tests**
   - manifest rendering
   - multipart hydration
   - placeholder downgrade behavior
   - history-safe placeholder persistence
3. **Tool-path tests**
   - `upload_attachment` loads persisted refs instead of relay state
   - missing/cleared attachment errors are explicit
4. **Adapter and integration tests**
   - Telegram and Mattermost normalize to the same ingest contract
   - queued/coalesced messages preserve attachment refs correctly
   - Discord attachment mapping can be added later without changing orchestrator or tool contracts

## Design Summary

The recommended design is a **shared attachment pipeline**:

- adapters receive raw files
- papai persists them immediately into a durable attachment workspace
- the rest of the app uses stable attachment refs instead of platform `fileId`s
- the LLM hydrates only the attachments needed for the current turn
- tools use the same refs for uploads and other actions
- `/clear` resets the workspace

This is the smallest design that satisfies all approved requirements:

- first-class LLM use
- first-class tool use
- persistence until clear
- history-safe storage
- Telegram/Mattermost first
- Discord-compatible later
- provider-capability-architecture alignment
