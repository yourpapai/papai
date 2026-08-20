<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0317: Audio Message Transcription via a Sibling `src/stt/` Module with Whisper-Compatible Client

## Status

Accepted

## Date

2026-08-07

## Context

Telegram users send `voice` and `audio` messages that the bot previously could not
reason over — the LLM only saw text. The decision, recorded in
`docs/superpowers/plans/2026-04-11-audio-message-transcription-implementation.md`
(and its design spec
`docs/superpowers/specs/2026-04-11-audio-message-transcription-design.md`), was how
to add speech-to-text (STT) so that transcriptions become first-class content the
LLM reasons over, reusing the existing attachment pipeline
(`src/attachments/`) rather than building a parallel ingestion path.

Constraints at decision time:

- The work hard-depends on the file-attachments implementation; audio must ride the
  same store/resolver/manifest machinery.
- STT must not be locked to a single vendor — any OpenAI-compatible Whisper
  endpoint (SaaS or self-hosted) should work.
- Users who already configured LLM credentials should not be forced to duplicate
  keys for STT.
- Failure posture is hard-fail with a clear user-facing reply (no retry/backoff in
  v1), keeping behavior predictable.
- Mattermost/Discord audio stays `tool_only` in v1; video transcription and native
  multimodal audio are explicitly out of scope.

## Decision Drivers

- **Reuse over duplication** — audio must be a variant of the existing attachment
  model, not a separate subsystem.
- **STT reusability** — the STT client must be usable later for TTS, bulk
  transcription, and video audio-track work.
- **Credential ergonomics** — `stt_*` keys fall back to `llm_*` when unset.
- **Fail loudly, not silently** — transcription failures produce an explicit reply
  to the user before ingest, never a silently dropped message.
- **Provider-agnostic STT endpoint** — configurable `baseUrl` targets any
  Whisper-compatible API.

## Considered Options

### Option 1: Sibling `src/stt/` module + `StoredAudioAttachment` discriminated union (chosen)

- **Pros**: STT is a transformation service the attachment subsystem calls into;
  reusable for future TTS/bulk/video work; audio metadata travels with the
  attachment through the existing store, resolver, and manifest rendering;
  `kind` discriminator keeps generic and audio paths type-safe.
- **Cons**: Requires schema/type changes in `src/attachments/` (new union variant,
  audio metadata persistence), touching a shared module.

### Option 2: STT as a child of `src/attachments/` (e.g. `src/attachments/stt.ts`)

- **Pros**: Fewer top-level modules; keeps audio concerns colocated.
- **Cons**: Couples a reusable transformation service to one consumer; future
  non-attachment STT callers (TTS, video audio tracks) would import from an
  attachment-specific path, inverting the dependency direction.

### Option 3: Transcribe in the Telegram adapter without persisting as attachments

- **Pros**: Simplest v1; no schema changes; transcription just becomes message
  text.
- **Cons**: Loses provenance (no blob, duration, model, language metadata); audio
  cannot participate in the attachment manifest/history machinery; duplicates
  ingestion logic the attachment pipeline already owns; blocks future phases
  (video, multimodal) that need stored audio.

### Option 4: Require dedicated `stt_*` credentials with no `llm_*` fallback

- **Pros**: Explicit configuration; no ambiguity about which endpoint is used.
- **Cons**: Poor ergonomics — most deployments use one OpenAI-compatible provider
  for both; forces duplicate key management for the common case.

## Decision

Adopt **Option 1** with the Option-4 rejection folded in via fallback:

1. **New `src/stt/` module as a sibling of `src/attachments/`** containing:
   - `types.ts` — `STTClient` interface, `STTResult`, `STTError` with typed failure
     reasons (`stt_not_configured`, `stt_file_too_large`,
     `stt_duration_too_long`, `stt_api_error`) and user-facing messages.
   - `client.ts` — OpenAI-compatible Whisper HTTP client
     (`POST {baseUrl}/v1/audio/transcriptions`, multipart form), with injectable
     `fetch` for tests.
   - `config.ts` — `resolveSTTConfig()` resolving `stt_apikey` → `llm_apikey`,
     `stt_baseurl` → `llm_baseurl` → `https://api.openai.com`, and
     `stt_model` → `whisper-1`; returns `null` when no key resolves.
2. **Attachment types extended with a `kind` discriminator**:
   `StoredAttachment = StoredGenericAttachment | StoredAudioAttachment`, where the
   audio variant carries required `durationSeconds`, `transcription`,
   `transcriptionModel`, and optional `transcriptionLanguage`.
3. **`ingestAudio()` on the attachment ingest service** persists pre-transcribed
   audio with its metadata; the resolver renders audio manifest entries
   (`[Voice attachment att_x (0:15, en): "…"]`) and truncated history
   placeholders (120 chars).
4. **Telegram adapter owns STT preflight**: extract `durationSeconds` on
   audio/voice candidates, resolve STT config, transcribe, and on any failure post
   a hard-fail reply (mapped from `STTError` reason) **before** calling ingest.
5. **New config keys** `stt_apikey`, `stt_baseurl`, `stt_model` registered in
   `ConfigKey`, `SENSITIVE_KEYS` (apikey masked), and the `/config` display names.

## Rationale

- Keeping `src/stt/` a sibling makes the dependency direction honest: attachments
  depend on STT, not vice versa, and future non-attachment consumers get a clean
  import path.
- Persisting the transcription **on** the attachment means the LLM manifest and
  conversation history render audio identically to other attachments — no special
  casing in prompt assembly beyond one resolver branch.
- The `llm_*` fallback means the zero-config path (user already has `llm_apikey`
  pointing at a Whisper-capable endpoint) works immediately, while `stt_*` keys
  allow a dedicated/cheaper STT provider.
- Hard-fail replies keep v1 behavior explainable; retry/backoff can be added later
  without changing the architecture.

## Consequences

### Positive

- Voice notes become first-class LLM context with provenance (duration, model,
  language) preserved.
- STT client is reusable for planned TTS, bulk transcription, and video
  audio-track phases without refactoring.
- Any Whisper-compatible endpoint works (OpenAI, Groq, self-hosted whisper.cpp
  servers, etc.).
- Zero additional configuration for users whose LLM endpoint already supports
  Whisper.

### Negative

- Shared `src/attachments/` types gain a union variant — every consumer of
  `StoredAttachment` must handle the `kind` discriminator (compiler-enforced).
- Hard-fail posture means transient Whisper outages surface as user-visible
  errors with no automatic retry.
- Audio metadata persistence requires schema/migration work in the attachment
  store.
- v1 is Telegram-only; Mattermost/Discord audio remains `tool_only`.

### Risks

- Whisper-compatible endpoints vary in multipart handling and error shapes;
  mitigation: client targets the documented OpenAI transcription API contract and
  treats any non-2xx/empty-text response as `stt_api_error`.
- 25 MB / 25 min limits are enforced at preflight; larger provider limits are not
  exploited. Mitigation: limits are constants, easy to revisit.

## Implementation Notes

- DI-first: `createSTTClient(config, deps)` accepts an injectable `fetch`;
  `resolveSTTConfig(userId, deps)` accepts an injectable `getConfig`.
- `stt_apikey` is registered in `SENSITIVE_KEYS` so `/config` output masks it.
- History placeholders truncate transcriptions at 120 characters.
- The plan was later marked **superseded** by
  `docs/superpowers/specs/2026-06-12-audio-transcribe-ux-fixes-design.md`; that
  follow-up refines the UX of this architecture rather than replacing it — the
  module boundaries and data model decided here stand.

## Related Decisions

- File-attachments implementation (hard dependency): audio rides the attachment
  store/resolver established there.
- `docs/superpowers/specs/2026-06-12-audio-transcribe-ux-fixes-design.md` — UX
  fixes that supersede the original plan document.

## References

- Plan: `docs/superpowers/plans/2026-04-11-audio-message-transcription-implementation.md`
- Design: `docs/superpowers/specs/2026-04-11-audio-message-transcription-design.md`
- OpenAI Audio Transcriptions API: `POST /v1/audio/transcriptions`
