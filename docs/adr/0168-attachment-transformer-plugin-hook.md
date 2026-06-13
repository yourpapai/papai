<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0168: Attachment Transformer Plugin Hook

## Status

Implemented

## Date

2026-06-12

## Context

The 2026-04-11 audio transcription design (`docs/superpowers/specs/2026-04-11-audio-message-transcription-design.md`) specified a `src/stt/` core module with hard-fail, pre-turn transcription. What shipped was the `audio-transcribe` plugin with a lazy LLM-tool approach instead. Verification against the original design goals uncovered six functional gaps:

1. **Multimodal models break the voice flow.** `buildUserTurnMessages` was emitting `audio/*` file parts to multimodal-prefixed models, causing strict providers to reject the part and the prompt-fragment trigger to never fire.
2. **Non-deterministic UX.** Transcription depended on the model obeying a prompt fragment, with an extra round-trip of latency per voice note.
3. **Stale credential closure.** The plugin read `api_key`/`base_url`/`model` once at activation; credential rotation or first-time setup required a restart.
4. **Endpoint lock-in.** The static `providerAllowedHosts` allowlist pinned specific domains; self-hosted Whisper required a manifest edit, which cleared approval.
5. **Unbounded KV cache.** `transcript:*` entries accumulated without pruning.
6. **No scenario awareness.** The pipeline could not distinguish voice notes (origin `'voice'`) from audio files (origin `'file'`), nor forwarded voice from the user's own. Group voice notes never reached turn time because group staged files resolved lazily.

The 2026-06-12 spec (`docs/superpowers/specs/2026-06-12-audio-transcribe-ux-fixes-design.md`) addressed all six gaps and is the source of truth for the architecture described here.

## Decision Drivers

- **Deterministic UX**: voice transcription must happen before the LLM turn, not inside it.
- **Generality**: the mechanism should be reusable for future video transcription, document OCR, and image captioning without a new core hook per use case.
- **Plugin isolation**: core must absorb all failures; a transformer can never block or drop a turn.
- **Operator trust**: allowing self-hosted endpoints without manifest edits requires a trust model grounded in admin-scoped config, not user-controlled input.
- **No restart on credential rotation**: config must be read at execute time.

## Decision

Six coordinated changes implement the architecture:

### 1. Generic attachment-transformer contribution (core)

A new `contributes.attachmentTransformers` manifest field and `ctx.registration.registerAttachmentTransformer(transformer)` registration method (requires `attachments.read` permission). Transformers declare `mimePrefixes`, optional `filenameExtensions` (MIME fallback), optional `origins` filter, and `timeoutMs` (clamped 1000–120000 ms, default 30000 ms).

Core dispatches transformers from active, eligible plugins for the current context — sorted by plugin ID for determinism — finding the first match per attachment. Each transform runs under its per-call timeout. A wall-clock budget of 120 seconds covers the entire per-turn batch. Core owns all message formatting and bracket-sanitization; the plugin returns plain text only. Every exception and timeout is caught at the dispatch boundary and rendered as a failure marker line; the turn always proceeds.

Rendering:

- Success: `[Voice attachment att_x (0:15, en): "…"]`
- Forwarded: `[Forwarded voice from "Alice" att_x (0:15): "…"]`
- Failure: `[Voice attachment att_x: transcription unavailable — <reason>]`

History uses a 120-character truncated placeholder; the full transcript stays in the plugin KV cache.

### 2. `origin` and `forwarded_from` columns (migration 054)

Nullable `origin` (`'voice'` | `'file'`) and `forwarded_from` (display name string) columns added to both `attachments` and `staged_files`. Written by `persistIncomingAttachments` / `stageFileMetadata`. Surfaced on `StoredAttachment`, `StagedFileRef`, and `PluginAttachmentRecord`. Adapters set the fields: Telegram from `message.voice` and `forward_origin`; Discord from the voice-message flag; Mattermost always `'file'`. Persisting origin in the DB means queue coalescing and retries re-derive the correct dispatch policy without in-memory state threading.

### 3. Eager group voice resolution (bot.ts)

Before turn assembly, staged files from the current message with `origin: 'voice'` are resolved immediately via the existing staged-file download machinery; their attachment IDs join `newAttachmentIds`. Ordinary staged files keep their existing lazy resolution. This ensures group voice notes are available at transform dispatch time.

### 4. Execute-time plugin config with context-scoped overrides

`PluginToolRuntimeContext` gains `contextConfig: { get(key: string): string | undefined }` resolving context-scoped `configRequirements` values. The same key name may exist in both admin and context scopes — they are independent stores. The `audio-transcribe` plugin uses this to let individual contexts supply their own `api_key` and `model` while keeping `base_url` admin-only (a context-owner-settable endpoint would let a context redirect requests carrying the admin's key to an arbitrary host).

> **Amended 2026-06-12:** Context-scoped `base_url` override added in plugin v2.1 with strict credential pairing and two-tier host trust. Context `base_url` requires context `api_key` (and vice versa); mismatched pairs return `incomplete_context_override`. Admin-config hosts bypass HTTPS/public-IP checks (operator-trusted tier); context-config hosts pass allowlist membership but require full validation (untrusted tier). See `buildContextDynamicHosts` (`src/plugins/dynamic-hosts.ts`) and the `contextHosts` param of `buildProviderRuntime`.

Credentials are resolved at execute time, not at activation, so rotation and first-time setup take effect on the next message.

### 5. `providerAllowedHostsFromConfig` manifest field

A new optional manifest field listing admin-scoped config key names whose runtime values contribute their host to the HTTP allowlist at call time. Schema-validated: every referenced key must exist in `configRequirements` with `scope: 'admin'`. Hosts contributed this way bypass the public-IP restriction that static `providerAllowedHosts` enforce — deliberately, to support self-hosted Whisper on a LAN. Static manifest hosts keep the public-IP restriction. Requires `http` or `provider.task` permission.

### 6. `audio/*` content-part suppression (core)

`recordToPart` no longer emits `audio/*` file parts regardless of plugin state, restoring the original design invariant that audio bytes never reach the LLM as content parts. The text content path (time tag + attachment/transcript lines + user text) is identical for text-only and multimodal models.

## Consequences

### Positive

- Voice notes are transcribed deterministically before the LLM turn on all platforms with a file pipeline.
- Core absorbs all transformer failures; no voice note can block or drop a turn.
- Audio bytes never reach the LLM as content parts, eliminating multimodal-model rejections.
- Self-hosted Whisper endpoints work without manifest edits by setting `base_url` in admin config.
- Credential changes take effect on the next message without a restart.
- The transformer hook is generic: future video transcription, document OCR, or image captioning reuse it without a new core hook.
- `origin` and `forwardedFrom` on `PluginAttachmentRecord` let transformers and tools correctly attribute forwarded voice.

### Negative

- **Discord has no file extraction today.** The file pipeline does not extract voice attachments from Discord messages, so the transformer hook has no effect there. This is a platform gap, not a hook gap; it is tracked as a follow-up.
- **Manifest change clears plugin approval.** Adding `contributes.attachmentTransformers` to the `audio-transcribe` manifest clears its approval by design (the approval hash covers manifest + entry source). Admins must re-approve `audio-transcribe` after deploying.
- **Transformer cancellation is cooperative-only.** The per-call timeout resolves the race, but there is no `AbortSignal` passed to the transformer. If a transformer does not self-cancel after a timeout, the in-flight call may keep running and holding its runtime context after the dispatch function returns the failure line. This is a known limitation, not a regression; it is tracked as a follow-up.
- **Bracket sanitization is not applied uniformly to all surfaces.** The `sanitizeForBracket` helper is applied to transformer output and attachment lines rendered from transform results. Older surfaces (reply-context quoted text) still embed platform text unsanitized. Tracked as a follow-up.
- **Re-sending the same platform file creates a new attachment.** The pipeline re-stages and re-resolves into a new `StoredAttachment` row. The KV cache means the upstream API is not billed again, but the previous attachment record is not reused. This is intentional: idempotency at the attachment level would require a cross-message content-hash lookup that is not implemented.

## Related Decisions

- ADR-0119: Shared Attachment Pipeline — the durable attachment workspace this hook integrates with.
- ADR-0123: Trusted-Local Plugin System — the plugin activation model and contribution lifecycle.
- ADR-0063: Web Fetch MVP — the rate-limiting and allowlist patterns `providerAllowedHostsFromConfig` extends.
