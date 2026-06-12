<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Audio Transcribe UX Fixes: Deterministic Pre-Turn Transcription via Attachment Transformers

**Date:** 2026-06-12
**Status:** Approved
**Supersedes:** `docs/superpowers/specs/2026-04-11-audio-message-transcription-design.md` (and its implementation plan) as the description of how audio transcription works. The 2026-04-11 design was implemented as the `audio-transcribe` plugin with an LLM-driven `transcribe` tool instead of the documented core `src/stt/` module; this spec fixes the functional gaps of that pivot and records the target architecture.

## Problem Statement

The shipped `audio-transcribe` plugin transcribes lazily through an LLM tool. Verification against the original design found these functional gaps:

1. **Multimodal models break the voice flow.** `buildUserTurnMessages` sends `audio/*` attachments as raw `file` parts to multimodal-prefixed models and omits the `[User attached …]` line from the live turn, so the transcribe prompt-fragment trigger never fires and strict providers reject the part outright.
2. **Prompt-dependent, non-deterministic UX.** Whether a voice note gets transcribed depends on the model obeying a prompt fragment, with a tool round-trip of extra latency per voice note.
3. **Silent degradation when unconfigured.** A missing `api_key` makes the plugin ineligible, hiding the tool and fragment; the bot just cannot handle voice, with no actionable message.
4. **Stale credential closure.** The plugin reads `api_key`/`base_url`/`model` once at activation; rotation or first-time setup requires a restart.
5. **Endpoint lock-in.** The manifest host allowlist pins `api.openai.com`/`api.groq.com`; self-hosted Whisper endpoints require a manifest edit, which clears approval.
6. **Unbounded KV cache.** `transcript:*` entries are never pruned.
7. **MIME edge case.** Telegram audio without a `mime_type` is rejected as `unsupported_media_type`.
8. **No scenario awareness.** The pipeline cannot distinguish a voice note (the voice _is_ the message) from an attached audio file (usually meant for a task), nor a forwarded voice note (someone else's words) from the user's own. Group chats stage files lazily, so a group voice note addressed to the bot is never available at turn time.

## Decisions (resolved during brainstorming)

| Question       | Decision                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger model  | Deterministic pre-turn transcription via a new generic core hook (Approach A: attachment transformers); the LLM tool remains as a fallback.                                                                                   |
| Credentials    | Admin-scoped key as deployment default; optional context-scoped `api_key`/`model` overrides. `base_url` stays admin-only. (**Amended 2026-06-12:** context `base_url` override added with strict pairing — see §5 amendment.) |
| Failure UX     | Failures are injected into the turn as marker lines; the turn always proceeds; no hard-fail replies.                                                                                                                          |
| Platforms      | All platforms, matched by MIME/extension + origin; no provider branching in the transcription path.                                                                                                                           |
| Endpoints      | New `providerAllowedHostsFromConfig` manifest field lets admin-set `base_url` contribute its host to the HTTP allowlist.                                                                                                      |
| Tool retention | The `transcribe` tool stays for re-transcription with a language hint and for on-demand transcription of audio files.                                                                                                         |
| Hook shape     | Generic attachment-transformer registration (`mimePrefixes`/`filenameExtensions`/`origins` filters), not a transcription-specific hook.                                                                                       |

## Goals

1. A voice note sent to the bot — DM or group, own or forwarded, on any platform — is transcribed before the LLM turn starts, and the transcript reaches the model deterministically.
2. Forwarded voice is attributed; the model never mistakes someone else's words for the user's.
3. Attached audio _files_ are not auto-transcribed; the `transcribe` tool covers them on demand.
4. Every failure mode produces an actionable in-turn marker line; no silent degradation, no dropped turns, captions always survive.
5. Credentials apply at the next message (no restart), support per-context BYOK, and allow self-hosted endpoints without manifest edits.
6. Audio bytes never reach the LLM as content parts, restoring the original design invariant.
7. The hook is generic: future video transcription, document OCR, or image captioning reuse it with a different MIME prefix.

## Non-Goals

- Video / `video_note` transcription, TTS responses, native multimodal audio (unchanged from the 2026-04-11 design).
- Retry/backoff for transient API errors (single attempt; failure line on error).
- Duration preflight (the 24 MiB size cap plus graceful API-error handling cover it; no duration metadata is persisted).
- Multilingual failure-line text (lines are English; the model rephrases conversationally).
- Eager transcription of audio files or of staged group files other than voice notes.

## Design

### 1. Scenario policy

| Scenario                          | Signal                                                                              | Policy                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice note, DM                    | Telegram `message.voice`; Discord voice-message flag                                | Auto-transcribe pre-turn; transcript rendered as the user's spoken words.                                                                                                   |
| Voice note, group (bot addressed) | Same, via staged file with `origin: 'voice'`                                        | Eagerly resolve the staged file pre-turn, then transcribe like a DM voice note. Only voice-origin staged files resolve eagerly; ordinary staged files keep lazy resolution. |
| Forwarded voice note              | `forward_origin` captured by the adapter                                            | Auto-transcribe with attribution: `[Forwarded voice from "Alice" att_x …]`.                                                                                                 |
| Audio file(s), sent or forwarded  | Telegram `message.audio`, documents with `audio/*` MIME, Mattermost/Discord uploads | Not auto-transcribed. Attachment line appears as today; the model calls `transcribe` on demand.                                                                             |

### 2. Origin signal and persistence

`IncomingFile` and `IncomingFileCandidate` gain two optional fields:

```typescript
origin?: 'voice' | 'file'        // default 'file'
forwardedFrom?: string           // display name of the original sender, when forwarded
```

Adapters set them: Telegram from `message.voice` and `forward_origin`; Discord from the voice-message flag; Mattermost always `'file'`.

A migration adds nullable `origin` and `forwarded_from` columns to both `attachments` and `staged_files`, written through `persistIncomingAttachments` / `stageFileMetadata` and surfaced on `StoredAttachment` and `StagedFileRef`. Persisting (rather than threading in-memory state) means queue coalescing, retries, and turn re-assembly re-derive policy from the DB.

### 3. Attachment-transformer plugin API (core)

**Manifest.** New contribution list `contributes.attachmentTransformers: string[]` (tool naming rules). A manifest refinement requires the `attachments.read` permission when transformers are declared.

**Registration.** `ctx.registration.registerAttachmentTransformer(transformer)`, rejected unless the name is declared — the `registerTool` pattern.

```typescript
type PluginAttachmentTransformer = {
  name: string
  /** Matched against attachment mimeType, e.g. ['audio/'] */
  mimePrefixes: readonly string[]
  /** Fallback match when the attachment has no MIME type, e.g. ['.ogg', '.opus', '.mp3'] */
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

type AttachmentTransformResult =
  | { ok: true; text: string; meta?: { language?: string; durationSec?: number } }
  | { ok: false; reason: string } // short human-readable, rendered into the failure line
```

The transformer receives only the attachment record and pulls bytes through `runtimeContext.attachments.read()` — the same permission-gated path the tool uses. It returns plain text; **core owns all message formatting**, so a plugin cannot inject unfenced content into prompt structure.

**Runtime context addition.** `PluginToolRuntimeContext` gains `contextConfig: { get(key: string): string | undefined }`, resolving context-scoped `configRequirements` values via the existing `getPluginConfig(contextId, pluginId, key)`. `PluginAttachmentRecord` gains `origin` and `forwardedFrom` so transformers and tools see the same metadata core sees.

**Dispatch rule.** For a context, core collects transformers from plugins that are active, enabled, and eligible (`getPluginsForContext`). An attachment matches when its `mimeType` starts with any `mimePrefixes` entry, or — when `mimeType` is absent — its filename ends with any `filenameExtensions` entry; and its origin passes the `origins` filter. First match wins, ordered by plugin id for determinism; one transform per attachment per turn.

### 4. Turn assembly integration (core)

Two integration points:

1. **Group eager-resolve** (`bot.ts`, before turn assembly): staged files from the current message with `origin: 'voice'` are resolved immediately via the existing staged-file download machinery; their attachment ids join `newAttachmentIds`.
2. **Transform dispatch** (`buildUserTurnMessages`, `src/llm-orchestrator-attachments.ts`): each new attachment that matches an eligible transformer is transformed under its `timeoutMs`. Core does no caching; the plugin caches in its KV, so coalesced retries hit the cache.

**Rendering (core-owned), one line per transformed attachment:**

- Success: `[Voice attachment att_x (0:15, ru): "transcript"]` — duration/language from meta, each omitted when absent.
- Forwarded: `[Forwarded voice from "Alice" att_x (0:15): "transcript"]`.
- Failure: `[Voice attachment att_x: transcription unavailable — <reason>]`.

Any transformer exception or timeout is caught at the dispatch boundary and rendered as a failure line. A transform can never block or drop the turn.

**Multimodal-path fix (ships regardless of plugin state).** `recordToPart` stops emitting `audio/*` file parts. The text content (time tag + attachment/transcript lines + user text) is built identically for the text-only and multimodal paths; image and document parts still attach as today.

**History persistence.** The live turn carries the full transcript. The persisted history message uses the truncated placeholder `[User attached att_x: voice.ogg — "first 120 chars…"]`; full text remains recoverable through the KV cache via the `transcribe` tool.

### 5. Plugin v2: audio-transcribe

**Manifest changes:**

- `contributes.attachmentTransformers: ["audio-transcribe"]`; the transformer registers `{ mimePrefixes: ['audio/'], filenameExtensions: ['.ogg', '.opus', '.mp3', '.m4a', '.wav', '.webm'], origins: ['voice'] }`.
- `api_key` (admin scope) becomes `required: false` so the plugin stays eligible when unconfigured and failures surface as marker lines instead of hidden contributions.
- New context-scoped optional `api_key` and `model`. `base_url` stays admin-only: a context-settable endpoint would let a context owner redirect requests carrying the admin's key to an arbitrary host.

> **Amended 2026-06-12:** Context `base_url` override added with strict pairing — see implementation. If context sets `base_url`, it must also set `api_key`, and vice versa; only one set returns `incomplete_context_override`. Admin-config hosts remain operator-trusted (bypass HTTPS/public-IP); context-config hosts are untrusted-tier (full validation required).

- New `providerAllowedHostsFromConfig: ["base_url"]` (see §6).

**Config resolution, at execute time** (kills the stale closure; rotation applies on the next message):

```text
apiKey  = contextConfig.get('api_key') ?? adminConfig.get('api_key')            // undefined → not_configured failure
model   = contextConfig.get('model')   ?? adminConfig.get('model')   ?? 'whisper-1'
baseUrl = adminConfig.get('base_url')                                ?? 'https://api.openai.com'
```

**Shared internals.** The transformer and the `transcribe` tool call one internal transcription function: same KV cache (`transcript:<attachment_id>`), same 24 MiB cap, same config resolution, same error vocabulary, and the same audio acceptance rule — `audio/*` MIME, falling back to the filename-extension list when the attachment has no MIME type. The extension fallback applies on the tool path too, fixing today's `unsupported_media_type` rejection of Telegram audio files that arrive without a `mime_type`. The tool keeps its surface (`attachment_id`, optional `language`).

**Cache hygiene.** Cached entries gain `cachedAt`; each cache write opportunistically prunes `transcript:*` entries older than 30 days via `kv.list`. No new permissions.

**Prompt fragment, rewritten:** transcripts of voice notes appear inline as `[Voice attachment …]` lines; call the `transcribe` tool only to re-transcribe with an explicit `language` when auto-detect clearly failed, or when the user asks to transcribe an audio file attachment.

### 6. Endpoint trust: `providerAllowedHostsFromConfig`

New optional manifest field listing **admin-scoped** config keys whose values contribute their host to the plugin's HTTP allowlist (schema-validated: every referenced key must exist in `configRequirements` with `scope: 'admin'`). The provider runtime computes the allowlist per call as static `providerAllowedHosts` ∪ host of each referenced admin config value.

Hosts contributed this way bypass the public-IP restriction that static hosts enforce — deliberately, to support self-hosted Whisper on a LAN. This is safe because admin config is operator-trusted input at the same trust level as manifest approval; LLM-controlled inputs cannot influence the target host. Static manifest hosts keep the public-IP restriction.

> **Amended 2026-06-12:** A second (untrusted) tier was added: context-config-sourced hosts pass the allowlist membership check but still require full HTTPS + public-IP validation. See `buildContextDynamicHosts` in `src/plugins/dynamic-hosts.ts` and the `contextHosts` parameter of `buildProviderRuntime`.

### 7. Error handling summary

Every failure converges on the same behavior: the turn proceeds and the model sees an actionable failure line.

| Failure                                                  | Marker reason                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| No API key (context or admin)                            | `not configured — the admin can set a transcription API key in the settings UI` |
| File over 24 MiB                                         | `file too large (max 24 MiB)`                                                   |
| Rate limited (shared web-fetch bucket, keyed by context) | `rate limited — try again shortly`                                              |
| API non-2xx / bad response / network / timeout           | `transcription service error`                                                   |
| Transformer exception or per-call timeout                | generic failure line, caught at the dispatch boundary                           |

## Testing

- **Core:** manifest schema (contribution list, `attachments.read` refinement, `providerAllowedHostsFromConfig` referencing only admin-scoped keys); registration gating; dispatch (MIME match, extension fallback, origin filter, eligibility, first-match determinism, timeout, exception → failure line); rendering (meta omission, forwarded attribution, failure reasons); `recordToPart` never emits `audio/*` parts; multimodal and text paths produce identical text content; history truncation at 120 chars; group eager-resolve fires only for `origin: 'voice'` staged files; `contextConfig` facade; allowlist-from-config including the public-IP bypass applying only to config-contributed hosts.
- **Adapters:** Telegram voice/audio origin tagging and `forward_origin` capture; Discord voice-message flag; Mattermost defaults to `'file'`.
- **Migration:** new nullable columns on `attachments` and `staged_files`.
- **Plugin:** transform happy path; config resolution order (context → admin → default); execute-time reads (rotation without restart); cache hit and prune; the existing tool test suite stays green.
- No new E2E, consistent with the 2026-04-11 testing posture.

## Documentation and Rollout

- Update `docs/plugins/developer-guide.md` (transformer contribution, `contextConfig`, `providerAllowedHostsFromConfig`) and the CLAUDE.md plugin section.
- Mark the 2026-04-11 spec and implementation plan as superseded with pointers to this spec.
- Write an ADR recording the plugin-architecture pivot and the attachment-transformer hook.
- **Rollback:** per-context disable or plugin rejection makes the hook inert (dispatch with no registered transformers is a no-op). The `recordToPart` audio suppression stays regardless — it is correct independently.
- **Operational note:** the manifest change clears plugin approval by design; admins re-approve `audio-transcribe` after deploying.
