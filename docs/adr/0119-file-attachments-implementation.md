<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0119: Shared Attachment Pipeline — Durable File Handling for LLM and Tool Workflows

## Status

Accepted

## Date

2026-04-11

## Context

papai had fragmented incoming-file support. Telegram and Mattermost adapters already downloaded files into `IncomingMessage.files`, and the bot carried those files through queueing. However, the pipeline suffered from several structural problems:

1. **Tool usage was turn-scoped only**. `upload_attachment` depended on the transient in-memory `file-relay.ts` and exposed platform `fileId` values in prompt text. Files disappeared from tool visibility as soon as the turn ended.
2. **LLM usage did not exist**. `llm-orchestrator.ts` sent string-only user messages and never hydrated attachments into `ImagePart` or `FilePart`.
3. **History could not safely hold binary content**. Conversation history is JSON text, and trim/summarization assumes text-first messages.
4. **Prompt rendering used transient platform IDs**. `buildPromptWithReplyContext()` surfaced `fileId` values that changed per-platform and per-turn.
5. **No persistence layer**. There was no way for a user to reference a file sent three messages ago.
6. **Discord compatibility was undefined**. The provider architecture required a shared contract, not provider-specific branching.

The codebase needed a unified attachment subsystem that could ingest platform files, persist them durably, expose stable identifiers to the LLM and tools, and keep history text-safe.

The design was captured in `docs/superpowers/specs/2026-04-11-file-attachments-design.md` and the implementation plan in `docs/superpowers/plans/2026-04-11-file-attachments-implementation.md`.

## Decision Drivers

- **Stable identifiers across turns**: Platform `fileId`s are transient; papai needs a durable identity that survives queue coalescing and history trimming.
- **Separate persistence from history**: Binary content must not enter JSON conversation history.
- **S3-compatible storage for portability**: Stateless deployments need attachments to survive restarts without requiring persistent local volumes.
- **Model-aware hydration**: Only send image/file parts to models that advertise multimodal support; fall back to text placeholders for others.
- **Provider-capability alignment**: The ingest contract must be platform-agnostic so Telegram, Mattermost, and future Discord implementations converge on one code path.
- **TDD enforcement**: Every layer (blob store, metadata store, workspace, resolver, queue, bot, tools, LLM) must have failing tests before implementation.

## Considered Options

### Option 1: Filesystem-backed blob storage with local SQLite metadata

- **Pros**: No external dependency; simplest single-node setup.
- **Cons**: Requires persistent host volume; files are lost on redeploy; incompatible with stateless container deployments; no path to multi-instance setups.

**Rejected.** Operational portability is a core requirement.

### Option 2: S3-compatible object storage with SQLite metadata (chosen)

- **Pros**: Stateless-friendly; works with AWS S3, R2, MinIO, B2; Bun ships `Bun.S3Client` natively; no new dependencies; same bucket can host future signed-URL delivery and lifecycle policies.
- **Cons**: Requires S3 credentials at runtime; network dependency for blob operations.

**Chosen.** The `BlobStore` abstraction keeps S3 details behind an interface, and an in-memory implementation enables fast unit tests without a live MinIO instance.

### Option 3: Keep `file-relay.ts` and extend it

- **Pros**: Minimal change to existing working code.
- **Cons**: Relay is purely in-memory and turn-scoped; cannot support "upload a file I sent three messages ago"; no persistence; platform IDs leak into prompts.

**Rejected.** The relay model cannot satisfy the "persist until /clear" requirement.

## Decision

Implement a **shared attachment pipeline** under `src/attachments/`:

1. `types.ts` — `AttachmentRef`, `StoredAttachment`, `SaveAttachmentInput`, status enums.
2. `blob-store.ts` — `BlobStore` interface with `Bun.S3Client` runtime backend and in-memory test backend.
3. `store.ts` — SQLite metadata persistence (Drizzle ORM) delegating byte I/O to `BlobStore`.
4. `workspace.ts` — Active attachment set queries and per-context clear behavior (deletes blobs from S3).
5. `ingest.ts` — Convert `IncomingFile[]` into persisted `AttachmentRef[]`.
6. `resolver.ts` — Build attachment manifests, select attachments for the current turn, detect multimodal model support, generate history-safe placeholder text.
7. Wire bot intake (`bot.ts` via `bot-attachments.ts`) to persist files before queueing and pass stable `attachmentId`s through the message queue.
8. Wire `reply-context.ts` to render manifests using papai attachment IDs instead of platform `fileId`s.
9. Wire `tools/upload-attachment.ts` to resolve workspace `attachmentId` instead of transient `fileId`.
10. Wire `llm-orchestrator.ts` (via `llm-orchestrator-attachments.ts`) to hydrate selected attachments into multipart model input while storing placeholder text in history.
11. Remove `src/file-relay.ts` once all consumers migrate to workspace lookups.

## Rationale

- **Stable IDs decouple layers**: Chat adapters, bot, queue, tools, LLM, and history all speak the same `attachmentId` language.
- **SQLite + S3 splits concerns**: Metadata (filtering, scoping, status) lives in the queryable database; bytes live in the object store closest to the network edge.
- **History safety**: By keeping binary content out of history JSON, trim and summarization logic requires no changes.
- **Model fallback**: `supportsAttachmentModelInput()` gates multipart hydration, preventing binary payloads from reaching text-only models.
- **Provider neutrality**: `IncomingFile` → `AttachmentRef` is a single normalization step; Telegram, Mattermost, and future Discord all produce the same downstream artifact.

## Consequences

### Positive

- Files persist across turns and survive bot restarts.
- Tools can upload files sent in earlier turns using stable `attachmentId`.
- Multimodal models receive `ImagePart`/`FilePart` input when supported.
- History remains text-only and trim-safe.
- `file-relay.ts` deleted — no dual maintenance.
- Object store allows future signed URLs, lifecycle expiration, and deduplication by checksum.

### Negative

- Runtime now requires S3-compatible credentials (`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). These are validated at startup; missing credentials fail fast.
- Network dependency for blob I/O adds latency to ingest and tool-upload paths.
- S3 DELETE failures during workspace clear are logged but do not block SQLite cleanup, which can leave orphaned objects. This is a documented operational edge case.

### Risks

- **Orphaned objects after clear**: Mitigated by logging + operator monitoring; future work could add a reconciliation job.
- **Model misclassification**: `supportsAttachmentModelInput()` uses a prefix whitelist. New multimodal models not matching known prefixes receive text placeholders instead of binary parts. Mitigation: update the whitelist when new model families are adopted.

## Implementation Status Detail

### Artifacts Verified in Codebase

| Layer          | Source Files                                                      | Tests                                                           |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Migration      | `src/db/migrations/030_attachment_workspace.ts`                   | `tests/db/migrations/030_attachment_workspace.test.ts` (2 pass) |
| Schema         | `src/db/schema.ts` — `attachments` table exported                 | `tests/db/schema.test.ts` (2 attachment tests pass)             |
| Types          | `src/attachments/types.ts`                                        | `tests/attachments/types.test.ts` (4 pass)                      |
| Blob store     | `src/attachments/blob-store.ts` (S3 + in-memory)                  | `tests/attachments/blob-store.test.ts` (8 pass)                 |
| Metadata store | `src/attachments/store.ts`                                        | `tests/attachments/store.test.ts` (3 pass)                      |
| Workspace      | `src/attachments/workspace.ts`                                    | `tests/attachments/workspace.test.ts` (4 pass)                  |
| Ingest         | `src/attachments/ingest.ts`                                       | Covered by workspace tests                                      |
| Resolver       | `src/attachments/resolver.ts`                                     | `tests/attachments/resolver.test.ts` (6 pass)                   |
| Prompt builder | `src/reply-context.ts` — manifest via `buildAttachmentManifest()` | `tests/reply-context.test.ts` (3 attachment assertions pass)    |
| Bot wiring     | `src/bot.ts` → `src/bot-attachments.ts`                           | `tests/bot.test.ts` (3 attachment workspace assertions pass)    |
| Queue          | `src/message-queue/types.ts`, `src/message-queue/queue.ts`        | `tests/message-queue/*.test.ts` (36 pass)                       |
| Tool wiring    | `src/tools/upload-attachment.ts` — resolves `attachmentId`        | `tests/tools/attachment-tools.test.ts` (5 upload tests pass)    |
| LLM wiring     | `src/llm-orchestrator.ts` → `src/llm-orchestrator-attachments.ts` | `tests/llm-orchestrator.test.ts` (3 attachment assertions pass) |
| /clear command | `src/commands/clear.ts` (preserves attachments; see Deviation 2)  | `tests/commands/clear.test.ts` (2 pass)                         |

### Removed Artifacts

- `src/file-relay.ts` — deleted.

### Files Modified Outside Plan Scope

- `src/attachments/staged.ts`, `src/attachments/staged-download.ts`, `src/db/staged-schema.ts` — follow-up **staged attachments** subsystem for group file candidates (metadata-only staging + deferred download). Not part of the original plan; see ADR-0091.

## Notable Deviations from Plan

1. **Migration numbering: 030 instead of 028**
   - Migrations 028 and 029 already existed. The attachment migration was created as 030. Schema and indexes match the plan exactly.

2. **`/clear` does NOT clear the attachment workspace**
   - The plan specified `clearAttachmentWorkspace()` in all three `/clear` paths. Post-implementation, the behavior was changed to **preserve** durable attachments across `/clear`. Tests in `tests/commands/clear.test.ts` assert this preservation. ADR-0091 (staged attachments) and the workspace-files tool (`src/tools/workspace-files.ts`) treat the attachment workspace as longer-lived than a single conversation session.

3. **`ProcessMessageInput` type not introduced**
   - The plan proposed a structured `ProcessMessageInput = { text, newAttachmentIds }` accepted by `processMessage()`. The actual implementation kept `processMessage()` as positional-parameter-based (`text`, `newAttachmentIds` as separate args). The `llm-orchestrator-attachments.ts` module (`buildUserTurnMessages`) performs the same resolution logic. Behavioral equivalence is maintained.

4. **Test-only DI hooks renamed**
   - `createInMemoryBlobStore` → `createInMemoryBlobStoreForTesting`, `setBlobStore` → `setBlobStoreForTesting`, `resetBlobStore` → `resetBlobStoreForTesting`.

## Forward Work

- **Discord file ingestion**: The shared ingest contract is ready; Discord adapter needs to populate `IncomingMessage.files` from attachment payloads. The provider already does not advertise `files.receive`.
- **Deduplication by checksum**: `checksum` column exists but is not yet used for deduplication.
- **Signed-URL delivery**: For large files or external sharing, the `BlobStore` abstraction can be extended with presigned URL generation without changing consumer code.
- **Attachment lifecycle policies**: S3 lifecycle rules or periodic reconciliation jobs can clean up orphaned objects.

## Related Decisions

- ADR-0091: Staged Attachments and Two-Tier File Handling — records the follow-up group-file-candidate subsystem built on top of the attachment workspace.
- ADR-0014: Multi-Chat-Provider Abstraction — provider capability architecture that this pipeline aligns with.
- ADR-0117: YouTrack Tool Parity Closure — references the attachment-context bug fix (`chatUserId` vs `contextId`) that occurred during the same timeframe.

## References

- Original design: `docs/archive/2026-04-11-file-attachments-design.md`
- Original implementation plan: `docs/archive/2026-04-11-file-attachments-implementation.md`
- Staged attachments design: `docs/adr/0091-staged-attachments-two-tier-file-handling.md`
- `src/attachments/` directory
