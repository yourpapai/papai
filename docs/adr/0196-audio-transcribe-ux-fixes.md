<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0196: Audio Transcribe UX Fixes

## Status

Implemented

## Date

2026-06-12

## Context

The shipped `audio-transcribe` plugin transcribes voice notes lazily through an LLM `transcribe` tool driven by a prompt fragment. Verification against the original 2026-04-11 STT design (`docs/superpowers/specs/2026-04-11-audio-message-transcription-design.md`) uncovered eight functional gaps: multimodal models break the flow (`buildUserTurnMessages` emitted `audio/*` file parts and omitted the `[User attached …]` line so the prompt-fragment trigger never fired and strict providers rejected the part); the UX was non-deterministic (transcription depended on the model obeying a prompt fragment, with an extra round-trip of latency per voice note); the plugin read credentials once at activation so rotation required a restart; the static `providerAllowedHosts` allowlist pinned specific domains so self-hosted Whisper needed a manifest edit (which cleared approval); the `transcript:*` KV cache grew without pruning; Telegram audio without a `mime_type` was rejected as `unsupported_media_type`; and the pipeline could not distinguish a voice note (the voice _is_ the message) from an attached audio file, nor a forwarded voice note (someone else's words) from the user's own, and group voice notes never reached turn time because group staged files resolved lazily.

The approved spec `docs/superpowers/specs/2026-06-12-audio-transcribe-ux-fixes-design.md` (superseding the 2026-04-11 design) is the source of truth for the architecture described here. Its central decision is a **deterministic pre-turn transcription** path via a new generic core hook — attachment transformers — so voice notes are transcribed before the model sees the turn and the transcript reaches it as a text line, not as an audio content part.

## Decision Drivers

- **Deterministic UX**: voice transcription must happen before the LLM turn, not inside it, and on every platform with a file pipeline.
- **Generality**: the mechanism must be reusable for future video transcription, document OCR, and image captioning without a new core hook per use case.
- **Plugin isolation**: core must absorb all failures; a transformer can never block or drop a turn — every error converges on an in-turn marker line.
- **Scenario awareness**: the pipeline must distinguish voice notes from audio files (via `origin`) and forwarded voice from the user's own (via `forwardedFrom`), persisted so queue coalescing and retries re-derive policy from the DB.
- **Operator trust vs user control**: self-hosted endpoints must work without manifest edits through a trust model grounded in admin-scoped config, while a context owner must not redirect requests carrying the admin's key to an arbitrary host.
- **No restart on credential rotation**: config must be read at execute time, not captured at activation.

## Considered Options

### Option A: Deterministic pre-turn attachment-transformer hook (chosen)

A generic `contributes.attachmentTransformers` manifest contribution dispatched from `buildUserTurnMessages` before the turn; the LLM `transcribe` tool stays as a fallback for re-transcription and on-demand audio-file transcription.

- **Pros:** deterministic — transcription happens before the model sees the turn; generic and reusable (MIME/extension/origin filters, not transcription-specific); core owns all formatting so a plugin cannot inject unfenced content; failures render as marker lines and the turn always proceeds.
- **Cons:** a new core hook with a per-call timeout budget to bound; every failure mode needs a deliberately-worded marker reason; the manifest change clears plugin approval by design.

### Option B: Strengthen the existing prompt-fragment + tool approach

Keep lazy LLM-driven transcription but harden the fragment, add the audio-part suppression, and read config at execute time.

- **Pros:** smaller surface — no new contribution type or dispatch path.
- **Cons:** still non-deterministic (the model may not obey the fragment); extra round-trip latency per voice note; cannot express scenario policy (voice vs file, forwarded attribution) without a parallel signal path anyway.

### Option C: Core `src/stt/` module with hard-fail pre-turn transcription

Revert to the original 2026-04-11 design: a core transcription module that hard-fails the turn when transcription is unavailable.

- **Pros:** matches the original design's wording; one code path.
- **Cons:** hard-fail drops the turn entirely on any transient API error; no plugin isolation; no operator self-service for endpoints/credentials; throws away the shipped plugin's BYOK and cache work.

## Decision

Six coordinated changes implement the architecture. The implementation plan executed them across 14 TDD tasks (migration → types → adapter capture → ingest/staging → manifest schema → registration → runtime context → provider runtime → dispatch/render → turn assembly → group eager-resolve → plugin v2 → docs → verification).

### 1. Generic attachment-transformer contribution (core)

A new `contributes.attachmentTransformers` manifest field (Zod-validated array of transformer names) and `ctx.registration.registerAttachmentTransformer(transformer)` registration method, rejected unless the name is declared — the `registerTool` pattern. Declaring transformers requires the `attachments.read` permission (manifest refinement). Transformers declare `mimePrefixes` (matched against `mimeType`), optional `filenameExtensions` (fallback when `mimeType` is absent), optional `origins` filter (`'voice'` | `'file'`), and `timeoutMs` (clamped 1000–120000 ms, default 30000 ms).

Core dispatches transformers from active, enabled, eligible plugins for the current context (`getPluginsForContext`), sorted by plugin ID for determinism; first match per attachment wins; one transform per attachment per turn. Each transform runs under its per-call timeout. Core owns all message formatting and bracket-sanitization; the plugin returns plain text only. Every exception and timeout is caught at the dispatch boundary and rendered as a failure marker line; the turn always proceeds.

- Success: `[Voice attachment att_x (0:15, en): "…"]` — duration/language from meta, each omitted when absent.
- Forwarded: `[Forwarded voice from "Alice" att_x (0:15): "…"]`.
- Failure: `[Voice attachment att_x: transcription unavailable — <reason>]`.

History uses a 120-character truncated placeholder (`[User attached att_x: voice.ogg — "first 120 chars…"]`); the full transcript stays recoverable in the plugin KV cache via the `transcribe` tool.

### 2. `origin` and `forwarded_from` columns (migration 054)

Nullable `origin` (`'voice'` | `'file'`) and `forwarded_from` (display name string) columns added to both `attachments` and `staged_files`. Written by `persistIncomingAttachments` / `stageFileMetadata`. Surfaced on `StoredAttachment`, `StagedFileRef`, and `PluginAttachmentRecord`. Adapters set the fields: Telegram from `message.voice` and `forward_origin` (`extractForwardedFrom`); Mattermost always `'file'`; Discord scoped out (no file extraction today, so `origin` defaults to `'file'` when it later gains one). Persisting origin in the DB means queue coalescing, retries, and turn re-assembly re-derive the correct dispatch policy without in-memory state threading.

### 3. Eager group voice resolution (bot.ts)

Before turn assembly, staged files from the current message with `origin: 'voice'` are resolved immediately via `resolveVoiceStagedFiles` (the existing staged-file download machinery); their attachment IDs join `newAttachmentIds`. Ordinary staged files keep their existing lazy resolution via the `resolve_staged_file` tool. This ensures group voice notes addressed to the bot are available at transform dispatch time.

### 4. Execute-time plugin config with context-scoped overrides

`PluginToolRuntimeContext` gains `contextConfig: { get(key: string): string | undefined }` resolving context-scoped `configRequirements` values via `getPluginConfig(contextId, pluginId, key)`; undeclared keys return `undefined`. The same key name may exist in both admin and context scopes (independent stores). The `audio-transcribe` plugin resolves config at execute time: context `api_key`/`model` override admin values; `base_url` pairing is strict (context `base_url` requires context `api_key` and vice versa; a mismatched pair returns `incomplete_context_override`); admin `base_url` stays the deployment default. Credentials take effect on the next message without a restart.

### 5. `providerAllowedHostsFromConfig` — two-tier host trust

A new optional manifest field lists config key names whose runtime values contribute their host to the HTTP allowlist at call time. Schema-validated: every referenced key must exist in `configRequirements`. Two tiers:

- **Admin-scoped** (`buildDynamicHosts`): operator-trusted (same trust level as manifest approval); hosts bypass the HTTPS and public-IP (SSRF) restrictions that static `providerAllowedHosts` enforce — deliberately, to support self-hosted Whisper on a LAN. LLM-controlled inputs cannot influence this set.
- **Context-scoped** (`buildContextDynamicHosts`): untrusted; hosts pass the allowlist membership check but still require full HTTPS + public-IP validation. Non-empty results are cached 30 seconds; empty results are never cached so newly-added context config is picked up without a restart.

Static manifest hosts keep the public-IP restriction.

### 6. `audio/*` content-part suppression (core)

`recordToPart` no longer emits `audio/*` file parts regardless of plugin state, restoring the original design invariant that audio bytes never reach the LLM as content parts. The text content path (time tag + attachment/transcript lines + user text) is identical for text-only and multimodal models; image and document parts still attach as today.

### 7. Plugin v2: `audio-transcribe`

The plugin registers an attachment transformer (`mimePrefixes: ['audio/']`, `origins: ['voice']`, `timeoutMs: 60000`) sharing one internal transcription function with the existing `transcribe` tool: same KV cache (`transcript:<attachment_id>`, group-shared via `storageScope: 'group'`), same 24 MiB cap, same config resolution, same error vocabulary, and the same audio-acceptance rule (`audio/*` MIME with filename-extension fallback, fixing the `unsupported_media_type` rejection of MIME-less Telegram audio). The `api_key` requirement becomes `required: false` so the plugin stays eligible when unconfigured and failures surface as marker lines. Cache entries gain `cachedAt`; each write opportunistically prunes `transcript:*` entries older than 30 days. The prompt fragment is rewritten to describe the inline `[Voice attachment …]` lines and to scope the `transcribe` tool to re-transcription (with a `language` hint) and on-demand audio-file transcription.

## Consequences

### Positive

- Voice notes are transcribed deterministically before the LLM turn on all platforms with a file pipeline (Telegram today; Mattermost by default; Discord pending file extraction).
- Core absorbs all transformer failures; no voice note can block or drop a turn — every error converges on an actionable marker line.
- Audio bytes never reach the LLM as content parts, eliminating multimodal-model rejections.
- Self-hosted Whisper endpoints work without manifest edits by setting `base_url` in admin config; context owners can BYOK their own endpoint+key pair with strict pairing.
- Credential changes take effect on the next message without a restart.
- Forwarded voice is attributed; the model never mistakes someone else's words for the user's.
- The transformer hook is generic: future video transcription, document OCR, or image captioning reuse it without a new core hook.

### Negative

- **Discord has no file extraction today.** The file pipeline does not extract voice attachments from Discord messages, so the transformer hook has no effect there. This is a platform gap, not a hook gap; tracked as a follow-up.
- **Manifest change clears plugin approval.** Adding `contributes.attachmentTransformers` to the `audio-transcribe` manifest clears its approval by design (the approval hash covers manifest + entry source). Admins must re-approve `audio-transcribe` after deploying and re-enable per context if needed.
- **Transformer cancellation is cooperative-only.** The per-call timeout resolves the race, but there is no `AbortSignal` passed to the transformer. If a transformer does not self-cancel after a timeout, the in-flight call may keep running and holding its runtime context after the dispatch function returns the failure line. Known limitation, tracked as a follow-up.
- **Re-sending the same platform file creates a new attachment.** The pipeline re-stages and re-resolves into a new `StoredAttachment` row. The KV cache means the upstream API is not billed again, but the previous attachment record is not reused (idempotency at the attachment level would require a cross-message content-hash lookup that is not implemented).
- **No bulk "apply to all" or global default for the per-context BYOK pair.** Each context sets its own override.

### Risks

- **Two-tier host trust misuse.** An admin who sets `base_url` to a private/LAN host grants the plugin the ability to reach it without HTTPS or public-IP checks. This is deliberate (operator-trusted tier), but a misconfigured or compromised admin config could direct transcription traffic to an attacker-controlled host. Mitigated by admin config being operator-trusted input at the same trust level as manifest approval, and by LLM-controlled inputs never influencing the set.
- **Context `base_url` redirect.** A context owner who sets `base_url` without `api_key` is rejected (`incomplete_context_override`); the strict pairing prevents redirecting requests that carry the admin's key to an arbitrary host. Context hosts still require full HTTPS + public-IP validation (untrusted tier).
- **Per-turn latency.** Each new voice note adds a synchronous transcription call (bounded by `timeoutMs`) before the turn. A 120-second wall-clock budget covers the per-turn batch; a single slow/failed transform does not block others.

## Related Decisions

- **ADR-0168** — Attachment Transformer Plugin Hook. Companion ADR recording the same architecture from the plugin-system perspective; this ADR records the UX-fix work that motivated and exercised the hook.
- **ADR-0119** — Shared Attachment Pipeline. The durable attachment workspace (`src/attachments/`) this hook integrates with and that migration 054 extends.
- **ADR-0123** — Trusted-Local Plugin System. The plugin activation model and contribution lifecycle the transformer contribution extends.
- **ADR-0063** — Web Fetch MVP. The rate-limiting and allowlist patterns `providerAllowedHostsFromConfig` extends.

## Implementation Notes

Confirmed present in the working tree:

- Migration 054 — `src/db/migrations/054_attachment_origin.ts:18` (adds `origin` + `forwarded_from` to `attachments` and `staged_files`; uses an idempotent `columnExists` guard via `PRAGMA table_info`); schema columns `src/db/attachments-schema.ts:27` and `src/db/staged-schema.ts:27`; registration `src/db/index.ts:67`.
- `AttachmentOrigin` / `toAttachmentOrigin` — `src/attachments/types.ts:8`, `:10`; `origin`/`forwardedFrom` on `StoredAttachment` (`:52`), `SaveAttachmentInput` (`:67`), `StagedFileRef` (`:107`), `StageFileParams` (`:122`); persistence `src/attachments/store.ts:69`/`:123`; staging `src/attachments/staged.ts:50`/`:76`/`:253`; ingest threading `src/attachments/ingest.ts:30`.
- Telegram capture — `extractForwardedFrom` `src/chat/telegram/file-helpers.ts:94`; voice tagged `:91` (`origin: 'voice'`); `forward_origin` shape `:19`; `IncomingFile`/`IncomingFileCandidate` fields `src/chat/types.ts:96`.
- Manifest schema — `contributes.attachmentTransformers` and `providerAllowedHostsFromConfig` validated in `src/plugins/manifest-validation.ts:70`, `:133`, `:142`, `:146`; refined in `src/plugins/types.ts:191`, `:235` (requires `attachments.read`), `:243` (config-key reference). Registration support `src/plugins/registration-support.ts:48`, `:189`; context facade `src/plugins/context.ts:61`, `:150`; contributions `src/plugins/contributions.ts:56`, `:115`; contribution filter `src/plugins/contribution-filter.ts:76`.
- Transformer types — `PluginAttachmentTransformer`, `AttachmentTransformResult`, `PluginToolRuntimeContext.contextConfig` `src/plugins/runtime-types.ts:85`–`:106`; `PluginAttachmentRecord.origin`/`forwardedFrom` `src/plugins/attachment-types.ts:19`; runtime-context facade `src/plugins/tool-runtime.ts:145`.
- Dispatch/render — `matchesTransformer` `src/plugins/attachment-transform.ts:31`; `renderTransformLine` `:64`; `executeTransformer` `:100`; `hasContextTransformers` `:170`; `transformNewAttachments` `:185`.
- Two-tier dynamic hosts — `buildDynamicHosts` (admin, bypasses https+public-IP) `src/plugins/dynamic-hosts.ts:23`; `buildContextDynamicHosts` (context, full validation, 30s cache) `:47`; provider runtime `validateHop` `src/plugins/provider-runtime.ts`.
- Turn assembly — `recordToPart` audio suppression `src/llm-orchestrator-attachments.ts:30`; `transformNewAttachments` dispatch `:99`; transformable set includes carry-over voice-origin records (`record.origin === 'voice'`) `:98`; unified live/history line builder `buildTurnLines` `:56`.
- Group eager-resolve — `resolveVoiceStagedFiles` `src/bot-attachments.ts:185`; voice-origin staged lookup `:147`; called from `src/bot.ts:134`, merged into `newAttachmentIds`.
- Plugin v2 — `plugins/audio-transcribe/plugin.json` (version `2.2.0`, `storageScope: "group"`, `contributes.attachmentTransformers: ["audio-transcribe"]`, `providerAllowedHostsFromConfig: ["base_url"]`, context `api_key`/`model`/`base_url` overrides); `plugins/audio-transcribe/index.ts` (execute-time `resolveConfig`, shared `transcribeRecord`, `isAudioRecord` extension fallback, `pruneOldTranscripts`, transformer registration).

Divergences from the original 2026-06-12 plan:

- **Idempotent migration.** Migration 054 guards each `ALTER TABLE` with a `columnExists` (`PRAGMA table_info`) check rather than the plan's plain `ALTER TABLE`, so re-running the migration on a partially-migrated DB is a no-op.
- **Two-tier host trust (spec amendment).** The plan's `providerAllowedHostsFromConfig` schema validation required admin-scoped keys only; the implemented schema (`src/plugins/types.ts:243`) accepts admin _or_ context-scoped keys, and `src/plugins/dynamic-hosts.ts` adds `buildContextDynamicHosts` (untrusted tier, full HTTPS + public-IP validation, 30s cache). This implements the spec's 2026-06-12 amendment adding context `base_url` override with strict credential pairing.
- **Plugin version 2.2.0, not 2.0.0.** Successive amendments (v2.1 context `base_url`; v2.2 refinements) landed after the plan's v2.0.0 draft.
- **`hasContextTransformers` export added.** `src/plugins/attachment-transform.ts:170` short-circuits the registry walk when no context has any active transformer plugin, avoiding a per-turn plugin-registry scan in the common no-plugin case; not in the original plan.
- **Carry-over voice transforms.** The orchestrator's transformable set (`src/llm-orchestrator-attachments.ts:98`) includes `record.origin === 'voice'` attachments beyond just `newAttachmentIds`, so a voice note carried over into a follow-up turn still transcribes; the plan scoped dispatch to new attachments only.
- **Manifest validation extracted.** Schema and refinements live in `src/plugins/manifest-validation.ts` (separate from `src/plugins/types.ts`), with `transformerNameSchema` reused for the contribution list.
- **`storageScope: "group"`.** The plugin manifest sets `storageScope: "group"` so the `transcript:*` KV cache is group-shared across sibling threads (voice notes are not re-transcribed per thread); the plan did not call this out explicitly.

Tests: `tests/db/staged-schema.test.ts` (migration columns), `tests/attachments/store.test.ts`/`tests/attachments/staged.test.ts` (origin round-trip), `tests/chat/telegram/file-helpers.test.ts` (voice origin + forward attribution), `tests/bot-attachments.test.ts` (DM ingest + group staging + `resolveVoiceStagedFiles`), `tests/plugins/manifest-schema.test.ts` (contribution + host-from-config refinements), `tests/plugins/contributions.test.ts` (registration gating), `tests/plugins/tool-runtime.test.ts` (`contextConfig` facade + attachment record origin), `tests/plugins/provider-runtime.test.ts` (dynamic hosts), `tests/plugins/attachment-transform.test.ts` (match/render/timeout/exception), `tests/llm-orchestrator-attachments.test.ts` (audio-part suppression, unified text, transcript injection), `tests/plugins/audio-transcribe.test.ts` (transformer registration, shared pipeline, execute-time config, cache pruning).
