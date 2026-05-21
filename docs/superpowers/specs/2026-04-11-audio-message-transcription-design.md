<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Audio Message Transcription Design: Whisper-Compatible STT for Telegram Voice/Audio

**Date:** 2026-04-11
**Status:** Draft
**Scope:** Speech-to-text transcription for Telegram `voice` and `audio` messages, layered on top of the shared attachment pipeline from the file-attachments design (same date). Video, TTS responses, vision, frame extraction, and Mattermost/Discord audio are explicitly out of scope.

## Problem Statement

papai is currently text-only end-to-end. Telegram's `extractFilesFromContext` already downloads `voice` and `audio` files into `IncomingFile`, and the file-attachments design persists them in a durable attachment workspace, but there is no code path that turns audio bytes into content the LLM can reason over. A user who sends a voice note saying "create a task to review the Q3 budget" currently gets either a silent drop or at best a manifest entry that the model cannot interpret.

Three related questions need answers:

1. How do we transcribe incoming Telegram voice/audio without adding a new system dependency (ffmpeg, native multimodal model, etc.)?
2. How do we integrate transcription into the shared attachment pipeline without breaking its "history stays text-safe, resolver is a pure mapping" invariants?
3. How do we surface failures to the user — configuration missing, file too large, Whisper API error — without swallowing them silently into LLM input?

## Goals

1. Telegram `voice` and `audio` messages are transcribed to text via a Whisper-compatible STT endpoint and the transcription becomes first-class content the LLM reasons over.
2. The audio file itself persists in the attachment workspace so tools (`upload_attachment` and friends) can still act on it — a voice note that becomes a task can still be uploaded to that task as an audio file.
3. Transcription is cached on the attachment record so queue coalescing, orchestrator retries, and history replays never bill Whisper twice for the same bytes.
4. Failures surface to the user _before_ the LLM turn starts, with one terse reply per failure kind. Turn is dropped, nothing reaches the LLM.
5. The STT configuration layer reuses the bot's existing per-user OpenAI-compatible credential pattern, with fallback to `llm_*` so single-provider users add zero new keys.
6. The design fits cleanly under the shared attachment pipeline from the file-attachments design and makes no provider-name branching assumptions downstream of the Telegram adapter.

## Non-Goals

- **Video, `video_note`, thumbnail vision, frame extraction.** Deferred to a future design (research doc Phases 2a / 2b / 2c).
- **Native multimodal audio to the LLM.** The research's Strategy B is blocked by the `@ai-sdk/openai-compatible` provider's audio type restrictions and by provider fragmentation. Deferred as research Phase 3.
- **TTS responses.** Replying with voice instead of text is its own design — new API client, new `ReplyFn` method, platform-specific voice-send wiring.
- **Mattermost and Discord audio attachments.** They continue to flow through the file-attachments pipeline as `kind: 'generic'` and are marked `tool_only` — stored but not transcribed, not hydrated to the LLM. A follow-up design unifies the pipeline once v1 proves itself on Telegram.
- **Retry/backoff for transient Whisper errors.** A single attempt, hard-fail on error. If retry becomes important, it can be added inside the STT client without touching the rest of the pipeline.
- **Multilingual UI and language preselection.** Whisper auto-detects language; no config key for forcing a language. Error messages are English-only.
- **Rewriting the existing `file-helpers.ts` audio extraction.** The research doc's proposed `file-download.ts` is not needed — `extractFilesFromContext` already handles voice/audio downloads.
- **New object storage, on-the-fly ffmpeg transcoding, per-user Whisper model overrides beyond the single `stt_model` key.**

## Current State

| Area                    | Current reality                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Telegram audio download | `src/chat/telegram/file-helpers.ts` already extracts `voice`, `audio`, `video`, `video_note` into `IncomingFile` with bytes.  |
| Attachment pipeline     | Designed but not yet implemented. `src/attachments/` does not exist on disk as of 2026-04-11.                                 |
| Incoming file contract  | `IncomingFile` in `src/chat/types.ts` already carries `content: Buffer` plus `mimeType`, `size`, `filename`.                  |
| LLM orchestrator        | String-only. `processMessage()` and `llm-orchestrator.ts` never see attachments.                                              |
| STT / TTS / Whisper     | Zero code. No config keys, no client, no tests.                                                                               |
| `file-relay.ts`         | Transient in-memory store used by the current `upload_attachment` tool. Scheduled for removal by the file-attachments design. |

## Hard Dependency

This design **layers on top of the approved file-attachments design** (2026-04-11). The following file-attachments components are prerequisites and are assumed to exist when this design is implemented:

- `src/attachments/` module with `ingest.ts`, `store.ts`, `workspace.ts`, `resolver.ts`, `types.ts`
- `StoredAttachment` persistence in SQLite with a blob store
- `AttachmentRef` as the stable ID that replaces transient platform `fileId`
- Attachment manifest rendering inside `buildPromptWithReplyContext()`
- `/clear` already resets the attachment workspace

If the file-attachments work has not landed at implementation time, the STT work blocks on it.

## Design

### 1. Data Model

Instead of adding optional `transcription?` / `durationSeconds?` fields to the base `StoredAttachment`, this design introduces a discriminated union keyed on a new `kind` field, with `StoredAudioAttachment` as a sibling type that carries required audio metadata.

```typescript
// src/attachments/types.ts

// Shared shape — this is the file-attachments design's StoredAttachment
// with a new `kind` discriminator added. Everything else is unchanged.
type BaseStoredAttachment = AttachmentRef & {
  sourceMessageId?: string
  sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown'
  sourceFileId?: string
  checksum: string
  blobPath: string
  createdAt: string
  clearedAt?: string
  lastUsedAt?: string
}

// Non-audio attachments — images, documents, everything that existed
// in the file-attachments design's original definition
type StoredGenericAttachment = BaseStoredAttachment & {
  kind: 'generic'
}

// Audio attachments — voice notes and audio files.
// All four extension fields are required by the type; the ingest
// service MUST populate them before persisting the row.
type StoredAudioAttachment = BaseStoredAttachment & {
  kind: 'audio'
  durationSeconds: number
  transcription: string
  transcriptionModel: string
  transcriptionLanguage?: string // optional ISO code from Whisper auto-detect
}

// Discriminated union — all persisted attachments are one of these
type StoredAttachment = StoredGenericAttachment | StoredAudioAttachment
```

**Why the audio fields are required, not optional.** Once an audio attachment exists in the workspace, duration and transcription are both known. Duration comes from Telegram's `audio.duration` / `voice.duration` metadata at ingest time — always present. Transcription is guaranteed present because ingest is synchronous (see §4): the Telegram handler either finishes the Whisper call successfully and writes a non-empty `transcription`, **or it never calls the ingest service in the first place** and posts a hard-fail reply instead. There is no "audio attachment with pending transcription" state to model.

**Failure path: no orphan audio rows.** When the Whisper call fails or preflight rejects the file, the Telegram adapter posts the terse error reply and **the audio attachment is never persisted at all**. This has one consequence worth calling out: if a user sends a voice note _plus typed caption_ in a single Telegram message and transcription fails, the whole message is dropped — the caption goes with it. This is the direct cost of the hard-fail posture combined with the "no orphan audio rows" rule. Acceptable because hard-fail is explicitly the chosen posture; failures should be visible.

**Cross-design note.** The `kind` field is a new discriminator on `BaseStoredAttachment` that the file-attachments design does not currently have. Since both designs are still paper, the file-attachments implementation should ship with `kind: 'generic'` on every attachment row from day one, and this STT design only introduces the second variant. Worth calling out in the file-attachments implementation plan.

**Resolver impact.** The attachment resolver becomes a `switch` on `kind`, which is future-proof for a `kind: 'video'` variant later:

```typescript
switch (attachment.kind) {
  case 'audio':
    // Emit manifest line: [Voice attachment att_123 (15s): "transcribed text..."]
    // Do NOT emit a FilePart / ImagePart — audio bytes never reach the LLM.
    return renderAudioManifestEntry(attachment)
  case 'generic':
    // Existing file-attachments resolver logic (ImagePart / FilePart / placeholder)
    return renderGenericAttachment(attachment)
}
```

### 2. Rejection reason codes

The `rejected` and `unavailable` status values from the file-attachments design gain new reason codes specific to STT:

| Reason code             | Status        | Trigger                                               |
| ----------------------- | ------------- | ----------------------------------------------------- |
| `stt_not_configured`    | `rejected`    | Neither `stt_apikey` nor `llm_apikey` is set          |
| `stt_file_too_large`    | `rejected`    | File exceeds 25 MB (OpenAI Whisper hard limit)        |
| `stt_duration_too_long` | `rejected`    | Duration exceeds 25 min per Whisper's documented cap  |
| `stt_api_error`         | `unavailable` | Whisper call returned non-2xx, threw, or empty result |

These codes live as string constants in `src/stt/types.ts` so the resolver, Telegram adapter, and tests can reference them without stringly-typed duplication.

Because failed audio is never persisted (see §1), these reason codes are primarily consumed by the Telegram adapter to pick the user-facing reply — they never land in a database row. Still worth defining up front so the shape is stable if the design later grows a "persist failures for observability" opt-in.

### 3. Module Layout

```text
src/
├── attachments/
│   ├── types.ts              [MODIFY] add kind discriminator + StoredAudioAttachment
│   ├── ingest.ts             [MODIFY] add ingestAudio() method
│   └── resolver.ts           [MODIFY] switch on kind, render audio manifest entry
├── stt/
│   ├── types.ts              [NEW] STTClient interface, STTResult, STTError types
│   ├── client.ts             [NEW] OpenAI-compatible Whisper client
│   └── config.ts             [NEW] resolves stt_* with fallback to llm_*
├── chat/
│   └── telegram/
│       ├── file-helpers.ts   [MODIFY] surface durationSeconds on audio/voice candidates
│       └── index.ts          [MODIFY] audio ingest branch with hard-fail reply path
├── config.ts                 [MODIFY] register stt_baseurl, stt_apikey, stt_model keys
└── commands/
    └── config.ts             [MODIFY] show stt_* keys in /config output
```

Four existing files touched, three new. The `src/stt/` module is a **sibling** of `src/attachments/`, not a child — STT is a transformation service that the attachment subsystem _calls into_, not an attachment concept per se. Keeping it separate means STT can be reused later by other callers (future TTS transcription of outgoing audio, future bulk batch transcription of archived files, future video audio-track transcription).

### 4. STT Module Contracts

#### `src/stt/types.ts`

```typescript
export interface STTClient {
  transcribe(input: STTInput): Promise<STTResult>
}

export type STTInput = {
  audio: Buffer
  mimeType: string
  filename: string
}

export type STTResult = {
  text: string
  model: string
  language?: string
}

export type STTFailureReason = 'stt_not_configured' | 'stt_file_too_large' | 'stt_duration_too_long' | 'stt_api_error'

export class STTError extends Error {
  constructor(
    public readonly reason: STTFailureReason,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
  }
}
```

The client is interface-typed for testability — the default implementation calls Whisper over HTTP, test doubles return canned text. Follows the existing DI pattern described in the project CLAUDE.md.

#### `src/stt/client.ts`

```typescript
export interface STTClientDeps {
  fetch: typeof globalThis.fetch
}

const defaultDeps: STTClientDeps = { fetch: globalThis.fetch.bind(globalThis) }

export function createSTTClient(config: STTConfig, deps: STTClientDeps = defaultDeps): STTClient {
  return {
    async transcribe({ audio, mimeType, filename }): Promise<STTResult> {
      const form = new FormData()
      form.append('file', new Blob([audio], { type: mimeType }), filename)
      form.append('model', config.model)
      form.append('response_format', 'json')

      const response = await deps.fetch(`${config.baseUrl.replace(/\/$/, '')}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
      })

      if (!response.ok) {
        throw new STTError('stt_api_error', `Whisper returned ${response.status}`)
      }

      const json = (await response.json()) as { text?: string; language?: string }
      if (json.text === undefined || json.text === '') {
        throw new STTError('stt_api_error', 'Whisper returned empty transcription')
      }
      return { text: json.text, model: config.model, language: json.language }
    },
  }
}
```

No retries, no backoff — the hard-fail posture says a single API error bubbles directly to the user.

#### `src/stt/config.ts`

```typescript
export type STTConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export async function resolveSTTConfig(userId: string): Promise<STTConfig | null> {
  const apiKey = (await getConfig(userId, 'stt_apikey')) ?? (await getConfig(userId, 'llm_apikey'))
  if (apiKey === undefined || apiKey === '') return null

  const baseUrl =
    (await getConfig(userId, 'stt_baseurl')) ?? (await getConfig(userId, 'llm_baseurl')) ?? 'https://api.openai.com'
  const model = (await getConfig(userId, 'stt_model')) ?? 'whisper-1'
  return { baseUrl, apiKey, model }
}
```

Returns `null` when STT is unreachable — the caller translates that into a `stt_not_configured` rejection.

### 5. Telegram Ingest Flow

Modified sequence in `src/chat/telegram/index.ts`:

```text
bot.on('message:voice' | 'message:audio')
  │
  ├─ extractFilesFromContext(ctx, fetchFile)           ─→ [IncomingFile + durationSeconds]
  │
  ├─ resolveSTTConfig(userId)
  │     └─ null ─→ reply.text("Voice messages need a speech-to-text key...") ; drop turn
  │
  ├─ preflight checks (size ≤ 25 MB, duration ≤ 25 min)
  │     └─ fail ─→ reply.text("This voice note is too large/long...") ; drop turn
  │
  ├─ sttClient.transcribe({ audio, mimeType, filename })
  │     └─ throws STTError ─→ reply.text("Couldn't transcribe this voice note...") ; drop turn
  │
  ├─ attachmentIngest.ingestAudio({
  │     bytes, mimeType, filename, durationSeconds,
  │     transcription, transcriptionModel, transcriptionLanguage,
  │   })                                                ─→ StoredAudioAttachment
  │
  └─ enqueue IncomingMessage with attachment ref        ─→ existing queue path
```

The key observation is that **Telegram audio is the only branch that ever calls STT in v1**. Every other MIME type and every other chat platform follows the existing file-attachments ingest path untouched. There is no generic `audio/*` dispatch inside `attachments/ingest.ts` — that would route Mattermost/Discord audio through STT too, which the scope explicitly defers. Instead, the Telegram adapter has its own branch, calls STT itself, and then hands a fully-formed audio payload to `attachmentIngest.ingestAudio()`, a new method distinct from the generic `ingestFile()` used for documents/photos/etc.

### 6. `attachmentIngest.ingestAudio()` — new method

```typescript
ingestAudio(input: {
  contextId: string
  sourceMessageId?: string
  sourceProvider: 'telegram'    // locked to telegram in v1
  sourceFileId: string
  bytes: Buffer
  mimeType: string
  filename: string
  durationSeconds: number
  transcription: string
  transcriptionModel: string
  transcriptionLanguage?: string
}): Promise<StoredAudioAttachment>
```

This method persists the blob, computes checksum, writes the SQLite row with `kind: 'audio'` and the four required audio fields set, and returns the `StoredAudioAttachment`. The generic `ingestFile()` method is unchanged and always writes `kind: 'generic'`.

### 7. Preflight Checks

Two size guards, both cheap:

| Check              | Limit   | Source                                                               |
| ------------------ | ------- | -------------------------------------------------------------------- |
| File size          | 25 MB   | OpenAI Whisper's documented hard limit on `/v1/audio/transcriptions` |
| Duration (seconds) | 25 × 60 | Whisper's documented 25-minute cap                                   |

Preflight uses the `size` and `duration` metadata Telegram already hands to `extractFilesFromContext` — no network calls, no file inspection. The check fires after download succeeds (Telegram's own 20 MB bot-download cap is hit earlier) but before the Whisper call, so Whisper bills only for files it will actually accept.

### 8. Configuration Surface

Three new per-user config keys, registered in `src/config.ts` and shown in `/config`:

| Key           | Default                                                    | Purpose                                       |
| ------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `stt_baseurl` | falls back to `llm_baseurl`, then `https://api.openai.com` | Base URL for the Whisper-compatible endpoint  |
| `stt_apikey`  | falls back to `llm_apikey`                                 | Bearer token for the STT endpoint             |
| `stt_model`   | `whisper-1`                                                | Model name sent to `/v1/audio/transcriptions` |

All three are **always shown** in `/config` (not conditionally hidden), so users discovering the feature via the output can see what's available. `stt_apikey` is value-redacted in `/config` output just like the existing `llm_apikey`.

`/config` output grouping stays unchanged — these keys slot into the existing "Common config keys" section alongside `llm_*`. Relevant code: `src/commands/config.ts`.

### 9. Error Message Catalog

Each failure produces exactly one terse reply, sent via `reply.text()` from the Telegram adapter before the turn is dropped. The turn is not enqueued, the LLM is never called, no attachment row is written.

| Reason code             | User-facing reply (English)                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `stt_not_configured`    | `Voice messages need a speech-to-text key. Run /set stt_apikey <key> or set llm_apikey.` |
| `stt_file_too_large`    | `This voice note is too large to transcribe (max 25 MB). Try a shorter recording.`       |
| `stt_duration_too_long` | `This voice note is too long to transcribe (max 25 min). Try a shorter recording.`       |
| `stt_api_error`         | `Couldn't transcribe this voice note. Please try again or send as text.`                 |

The messages are English-only in v1 — the rest of the bot's user-facing strings are English too. Messages live as string constants in `src/stt/types.ts` alongside the reason codes so tests can assert the exact mapping.

**No sticky/one-time behavior.** If a user sends three voice notes back-to-back without `stt_apikey` configured, they get the same reply three times. A "seen warning" session flag can be revisited if users complain about repeat warnings; v1 keeps the state machine as simple as possible.

### 10. Audio Manifest Rendering

When the attachment resolver encounters `kind: 'audio'` with `status: 'available'`, it emits one line of manifest text in `buildPromptWithReplyContext()`:

```text
[Voice attachment att_k7g2 (0:15, en): "Create a task to review the Q3 budget report by Friday"]
```

Format:

- `att_k7g2` — the stable attachment ID (already in the manifest vocabulary for generic attachments)
- `(0:15, en)` — duration as `m:ss` from `durationSeconds`, Whisper language code (omitted when `transcriptionLanguage === undefined`)
- `"..."` — the full transcription text, no truncation in v1

**No truncation** because Whisper's 25-minute cap bounds the worst case to ~3000 words, which is ~4000 tokens. That's cheaper than most tool outputs the orchestrator already routes into the context window. If long voice notes become a token pressure problem in practice, the conversation-trimming layer already handles that concern at a higher level.

The manifest line goes into the same manifest block as generic attachments. History persistence uses a trimmed variant:

```text
[User attached att_k7g2: voice.ogg — "Create a task to review the Q3 budget..."]
```

First 120 characters of `transcription`, ellipsis if longer. The full transcription is still available on the stored attachment row for tools that want it.

### 11. History Replay Semantics

When a user message with an audio attachment is trimmed out of the active context window by the existing conversation-trimming logic, the summary generator sees the history placeholder `[User attached att_k7g2: voice.ogg — "Create a task…"]` — not the full transcription and not the audio bytes. This is the existing summary pipeline's behavior for text; audio gets the same treatment for free because we reduced audio to text-plus-placeholder at ingest time.

### 12. Testing Strategy

Four test files, all unit-level. No new E2E.

**`tests/stt/client.test.ts`**

- `transcribe()` posts multipart with correct `file` / `model` fields
- `transcribe()` builds URL from `baseUrl` with and without trailing slash
- `transcribe()` returns `{ text, model, language }` on 200
- `transcribe()` throws `STTError('stt_api_error')` on non-2xx
- `transcribe()` throws `STTError('stt_api_error')` on empty-text response
- `fetch` is injected via `STTClientDeps`, no `globalThis.fetch` monkey-patching

**`tests/stt/config.test.ts`**

- `resolveSTTConfig()` returns `null` when neither `stt_apikey` nor `llm_apikey` exists
- `resolveSTTConfig()` falls back through `stt_*` → `llm_*` → hardcoded default for each field
- `resolveSTTConfig()` respects explicit `stt_*` keys over `llm_*` fallbacks
- Uses DI `Deps` for `getConfig` per the project's dependency-injection pattern

**`tests/chat/telegram/audio-ingest.test.ts`**

- Voice note happy path calls STT, calls `ingestAudio`, enqueues with attachment ref
- `stt_not_configured` posts correct reply, does not call STT, does not call ingest
- Oversize file (>25 MB) posts correct reply, does not call STT
- Over-duration (>1500s) posts correct reply, does not call STT
- STT throws → posts correct reply, does not call ingest
- Telegram `message:voice` and `message:audio` both route through the same path
- Telegram `message:document` with `audio/*` MIME continues to flow through the _generic_ ingest path and is not transcribed (regression guard against MIME-sniff creeping into ingest)

**`tests/attachments/audio-resolver.test.ts`**

- `kind: 'audio'` with `status: 'available'` renders manifest line with duration + language + text
- `kind: 'audio'` with no `transcriptionLanguage` omits the language suffix
- Manifest ordering: audio entries interleave with generic entries in the order they were attached
- History placeholder truncates transcription to 120 characters with ellipsis
- History placeholder does not truncate short transcriptions
- The resolver never emits a `FilePart` or `ImagePart` for an audio attachment

### 13. Rollback and Future Hooks

- **Rollback plan.** The feature is entirely additive. If STT behaves badly in production, removing the `message:voice` / `message:audio` handlers in `src/chat/telegram/index.ts` disables the feature globally without touching the attachment pipeline or database. A feature-flag config key is not needed given the hard-fail posture — users with no STT key already see zero behavioral change from v1 except the error reply.
- **Future hook for Mattermost/Discord.** The split between "STT call in adapter" and "generic ingest" is intentional so the later design can introduce a shared audio-ingest helper without disturbing the v1 Telegram path. The follow-up design just has to decide whether MIME detection lives in the adapter or in a shared middleware.
- **Future hook for video (research Phase 2a).** Whisper accepts mp4. A future design can reuse `sttClient.transcribe()` verbatim; the only addition is a `kind: 'video'` discriminant and a video-specific manifest renderer. No refactor of the STT module is required.
- **Future hook for TTS.** Reusing the `src/stt/` module name for speech-to-text only is intentional. TTS should live under `src/tts/` as a peer module — same shape, different direction.

## Design Summary

- **Scope:** Telegram `voice` and `audio` only. Hard-fail on any STT error. Single Whisper attempt, no retry.
- **Data model:** `StoredAttachment` becomes a discriminated union with `kind: 'generic' | 'audio'`. `StoredAudioAttachment` has required `durationSeconds`, `transcription`, `transcriptionModel`, optional `transcriptionLanguage`.
- **Persistence:** Failed audio is never persisted. A successfully transcribed audio attachment is stored exactly once, with transcription as a column alongside the blob metadata.
- **Pipeline:** Telegram adapter calls STT _before_ calling the attachment ingest service. Ingest has a new `ingestAudio()` entry point that requires all audio metadata up front. Mattermost/Discord audio flows through the existing generic path untouched.
- **Module layout:** `src/stt/` is a new sibling of `src/attachments/`, containing `types.ts`, `client.ts`, `config.ts`. Three new config keys (`stt_baseurl`, `stt_apikey`, `stt_model`) fall back through `llm_*` to OpenAI defaults.
- **LLM integration:** The attachment resolver switches on `kind` and emits a manifest line with the full transcription for audio. Audio bytes never reach the LLM as content parts.
- **History:** Audio attachments get a 120-char-truncated placeholder in persisted history; the full transcription stays on the attachment row for tools.
- **Testing:** Four unit-test files — STT client, STT config resolution, Telegram audio ingest branch, audio resolver rendering. No new E2E.
- **Rollback:** Remove the two Telegram handlers. Additive feature, no database migration to reverse.
