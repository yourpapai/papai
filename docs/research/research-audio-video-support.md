<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Research: Audio & Video Message Support

Research into adding support for handling and responding to audio/video messages from chat platforms.

## Current State

The bot is **text-only** end-to-end. No incoming media of any kind is processed.

| Layer                  | Current State                                             |
| ---------------------- | --------------------------------------------------------- |
| `IncomingMessage` type | `text: string` only — no media fields                     |
| Telegram adapter       | Listens to `'message:text'` only                          |
| Mattermost adapter     | Post schema captures `message` only, no `file_ids`        |
| LLM orchestrator       | `{ role: 'user', content: string }` — no multimodal parts |
| History storage        | `ModelMessage[]` as JSON — text only                      |

Existing research on general file attachments is in `docs/file-attachments-research.md`. This document focuses specifically on **audio and video** message types and the unique challenges they present.

## Audio/Video Message Types by Platform

### Telegram

| Type       | Filter Query         | Key Properties                                                        | Typical MIME              | Notes                                             |
| ---------- | -------------------- | --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------- |
| Voice note | `message:voice`      | `file_id`, `duration`, `mime_type`, `file_size`                       | `audio/ogg` (Opus codec)  | Recorded in-app, circular waveform UI             |
| Audio file | `message:audio`      | `file_id`, `duration`, `mime_type`, `file_size`, `title`, `performer` | `audio/mpeg`, `audio/mp4` | Forwarded music/podcasts                          |
| Video      | `message:video`      | `file_id`, `duration`, `width`, `height`, `mime_type`, `file_size`    | `video/mp4`               | Standard video files                              |
| Video note | `message:video_note` | `file_id`, `duration`, `width`, `height`, `file_size`                 | `video/mp4`               | Circular "telescope" videos, no `mime_type` field |

**File download flow:**

```
ctx.api.getFile(file_id) → File { file_path } → fetch(`https://api.telegram.org/file/bot${token}/${file_path}`)
```

- Download links valid for **1 hour**
- **20MB hard limit** on bot file downloads (server-side)
- Grammy has no built-in download helper — must `fetch()` manually
- Media messages use `ctx.message.caption` for text, not `ctx.message.text`

### Mattermost

- Posts include `file_ids: string[]` for any attached files
- Metadata: `GET /api/v4/files/{fileId}/info` → includes `name`, `size`, `mime_type`
- Content: `GET /api/v4/files/{fileId}` → raw bytes
- 2 HTTP calls per file add latency

## Strategies for Audio/Video Processing

There are three fundamentally different approaches, each with different trade-offs:

### Strategy A: Speech-to-Text Transcription (Recommended for v1)

Convert audio to text before sending to the LLM — the bot continues to operate in text mode.

**How it works:**

```
User sends voice note → Download audio bytes → Transcribe via STT API → Send text to LLM
```

**STT Provider Options:**

| Provider           | API                             | Audio Formats                             | Max Duration        | Cost (approx)           |
| ------------------ | ------------------------------- | ----------------------------------------- | ------------------- | ----------------------- |
| OpenAI Whisper API | `POST /v1/audio/transcriptions` | mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg | 25 min              | $0.006/min              |
| Groq Whisper       | Same OpenAI-compatible API      | Same formats                              | 25 min              | $0.02/hr (~$0.0003/min) |
| Local Whisper      | Self-hosted                     | All ffmpeg formats                        | Unlimited           | Free (CPU/GPU cost)     |
| Deepgram           | REST API                        | Most formats                              | Streaming supported | $0.0043/min             |

**Why this is recommended for v1:**

- The bot is a **task management** assistant — voice messages almost always contain instructions ("create a task for...", "what's the status of...")
- Text transcription preserves the full pipeline: tools, history, trimming all work unchanged
- No multimodal LLM required — works with any text model
- Conversation history stays text-only (no storage bloat)
- Cheapest option — Groq Whisper is nearly free

**Implementation sketch:**

```typescript
// New: src/transcription.ts
export async function transcribeAudio(
  audioData: Uint8Array,
  mimeType: string,
  config: { apiKey: string; baseUrl?: string },
): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([audioData], { type: mimeType }), 'audio.ogg')
  formData.append('model', 'whisper-1')

  const response = await fetch(`${config.baseUrl ?? 'https://api.openai.com'}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  })

  const result = await response.json()
  return result.text
}
```

**New per-user config keys:**

- `stt_baseurl` — STT API base URL (default: same as `llm_baseurl`)
- `stt_apikey` — STT API key (default: same as `llm_apikey`)
- `stt_model` — STT model name (default: `whisper-1`)

**User experience:**

```
User: [sends 15-second voice note]
Bot:  🎤 Transcribed: "Create a task to review the Q3 budget report by Friday"
      ✅ Task created: "Review Q3 budget report" (due: Friday)
```

### Strategy B: Native Multimodal (Audio Parts)

Send raw audio bytes directly to a multimodal LLM that supports audio input.

**How it works:**

```
User sends voice → Download bytes → Send as FilePart to LLM → LLM processes audio natively
```

**AI SDK v6 support:**

```typescript
const message: ModelMessage = {
  role: 'user',
  content: [
    { type: 'file', data: audioBytes, mediaType: 'audio/ogg', filename: 'voice.ogg' },
    { type: 'text', text: 'The user sent this voice message.' },
  ],
}
```

**Pros:**

- Preserves tone, emphasis, speaker identity
- Can handle non-speech audio (music, environmental sounds)
- Single API call

**Cons:**

- Requires a multimodal model that supports audio input (GPT-4o, Gemini 1.5 Pro — but NOT most open-source models)
- Since the bot uses `@ai-sdk/openai-compatible` with configurable providers, most users' models likely **don't** support audio input
- Audio tokens are expensive (~$0.06/min for GPT-4o audio)
- History serialization is problematic — can't store audio bytes in SQLite JSON
- Breaks conversation trimming (text-based token counting doesn't work for audio)

**Verdict:** Not recommended for v1 due to provider compatibility issues. Could be a future opt-in mode.

### Strategy C: Video Frame Extraction + Audio Transcription

Decompose video into frames (images) and audio, process each modality separately.

**How it works:**

```
User sends video → Download
                 → Extract audio track → Whisper STT → text transcription
                 → Extract key frames  → Send as ImageParts to vision LLM
                 → Combine: "[Video transcription]: ... [Frame descriptions]: ..."
```

**Frame extraction approaches:**

1. **ffmpeg (system dependency)**

   ```bash
   # Extract 1 frame per second
   ffmpeg -i input.mp4 -vf "fps=1" -q:v 2 frame_%04d.jpg
   # Extract only keyframes (I-frames) — fewer frames, faster
   ffmpeg -i input.mp4 -vf "select='eq(pict_type,I)'" -vsync vfr frame_%04d.jpg
   ```

   - Most reliable and flexible
   - Requires ffmpeg installed on the host (not bundled with Bun)
   - Can also extract audio: `ffmpeg -i input.mp4 -vn -acodec libopus audio.ogg`

2. **Bun/JS-native libraries (no system dependency)**
   - `mp4box.js` — MP4 demuxing in pure JS, can extract raw video frames but doesn't decode them to images
   - `ffmpeg.wasm` — WebAssembly port of ffmpeg, runs in Bun but ~30MB bundle and slower than native
   - No mature pure-JS solution for reliable frame extraction

3. **Telegram thumbnail** — Telegram provides a `thumbnail` (`PhotoSize`) on video messages. Send just the thumbnail as an `ImagePart` — zero processing needed, but only one frame and low resolution.

**Sending frames to the LLM:**

The `@ai-sdk/openai-compatible` provider supports `image/*` parts — it converts them to `image_url` with base64 data. So extracted JPEG frames can be sent directly:

```typescript
const message: ModelMessage = {
  role: 'user',
  content: [
    {
      type: 'text',
      text: '[Video transcription]: Create a task for the bug shown in this recording',
    },
    { type: 'file', data: frame1Bytes, mediaType: 'image/jpeg' },
    { type: 'file', data: frame2Bytes, mediaType: 'image/jpeg' },
    { type: 'file', data: frame3Bytes, mediaType: 'image/jpeg' },
    {
      type: 'text',
      text: 'The user sent a video message with the above frames and transcription.',
    },
  ],
}
```

**Pros:**

- Works with any vision-capable model (GPT-4o, Claude, Gemini, LLaVA, etc.)
- Understands visual content (screen recordings, screenshots of bugs, whiteboard photos)
- Combined with STT, provides comprehensive video understanding

**Cons:**

- ffmpeg system dependency (or slow WASM alternative)
- Multiple frames = high token cost (~1000 tokens per image, 10 frames = ~10k tokens)
- Adds 1-3s processing latency for frame extraction
- Not all user-configured models support vision

**Token cost for video frames:**

| Frames extracted | Approx. image tokens | + Audio transcription | Total added tokens |
| ---------------- | -------------------- | --------------------- | ------------------ |
| 1 (thumbnail)    | ~1,000               | ~100-500              | ~1,500             |
| 5 (1/10s)        | ~5,000               | ~100-500              | ~5,500             |
| 10 (1/5s)        | ~10,000              | ~100-500              | ~10,500            |

**Verdict:** Viable for Phase 2 if ffmpeg is available. Thumbnail-only approach works without dependencies.

### Strategy D: Native Video Input (Google Gemini)

Send the entire video file to an LLM that natively understands video.

**Current provider support (as of early 2026):**

| Provider         | Native video input | Notes                                                  |
| ---------------- | ------------------ | ------------------------------------------------------ |
| Google Gemini    | Yes                | 1.5 Pro, 1.5 Flash, 2.0 Flash — up to ~1hr video       |
| OpenAI GPT-4o    | No                 | Image input only; no video via API                     |
| Anthropic Claude | No                 | Image input only; no video via API                     |
| Open-source      | Limited            | Video-LLaVA, Qwen-VL — require custom inference setups |

**Gemini video API format:**

```json
{
  "contents": [
    {
      "parts": [
        {
          "fileData": {
            "mimeType": "video/mp4",
            "fileUri": "https://generativelanguage.googleapis.com/..."
          }
        },
        { "text": "Describe what happens in this video" }
      ]
    }
  ]
}
```

Gemini tokenizes video at ~263 tokens/second (1 fps sampling). A 30-second video ≈ 8,000 tokens. Audio track adds ~32 tokens/second.

**Critical blocker for this codebase:** The bot uses `@ai-sdk/openai-compatible`, which explicitly **rejects video MIME types** with `UnsupportedFunctionalityError` (verified in `convert-to-openai-compatible-chat-messages.ts:138`). The provider only maps:

- `image/*` → `image_url`
- `audio/*` → `input_audio` (wav/mp3 only)
- `application/pdf` → `file`
- `text/*` → `text`
- Everything else → **throws error**

To use Gemini's native video, the bot would need to add `@ai-sdk/google` as a dependency and allow users to select it as their provider. This is a significant architectural change since the current provider system assumes OpenAI-compatible APIs only.

**Verdict:** Not feasible with the current `@ai-sdk/openai-compatible` provider. Would require adding `@ai-sdk/google` support, which is a separate feature.

## Recommended Implementation Plan

### Phase 1: Voice Message Transcription (STT)

**Scope:** Telegram voice notes and audio files → transcribe → process as text.

**Changes required:**

| File                                 | Change                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `src/chat/types.ts`                  | Add `attachments?: IncomingAttachment[]` to `IncomingMessage`               |
| `src/chat/telegram/index.ts`         | Register handlers for `message:voice`, `message:audio`; download file bytes |
| `src/chat/telegram/file-download.ts` | New: download file from Telegram API by `file_id`                           |
| `src/transcription.ts`               | New: OpenAI-compatible STT API client                                       |
| `src/bot.ts`                         | If message has audio attachments, transcribe before passing to LLM          |
| `src/config.ts`                      | Add `stt_baseurl`, `stt_apikey`, `stt_model` config keys                    |
| `src/commands/config.ts`             | Show STT config keys in `/config` output                                    |

**New types:**

```typescript
type IncomingAttachment = {
  type: 'audio' | 'video' | 'image' | 'document'
  data: Uint8Array
  mimeType: string
  filename: string
  /** Duration in seconds (audio/video only) */
  duration?: number
}
```

**Message flow with transcription:**

```
Voice note → Telegram adapter downloads bytes → IncomingMessage.attachments
  → bot.ts detects audio attachment
  → transcribeAudio(attachment.data, attachment.mimeType)
  → prepend "[Voice message transcription]: {text}" to message
  → processMessage() handles it as normal text
```

**Graceful degradation:**

- If STT API key not configured: reply "Voice messages require STT configuration. Use `/set stt_apikey <key>` to enable."
- If download fails: reply "Could not download voice message. Please try sending as text."
- If transcription fails: reply "Could not transcribe voice message. Please try again or send as text."

### Phase 2: Video Message Processing

**Scope:** Handle video messages with audio transcription + optional visual understanding.

**Sub-phases:**

#### Phase 2a: Audio-only (no new dependencies)

Send the entire video file to Whisper — it accepts `mp4` and extracts audio automatically.

| File                         | Change                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/chat/telegram/index.ts` | Register handlers for `message:video`, `message:video_note`      |
| `src/bot.ts`                 | For video attachments, send to Whisper STT (same as voice notes) |

This reuses the Phase 1 STT pipeline with zero additional work.

#### Phase 2b: Thumbnail vision (no new dependencies)

Telegram provides a `thumbnail` on video/video_note messages. Send it as an `ImagePart` alongside the audio transcription.

| File                         | Change                                                                      |
| ---------------------------- | --------------------------------------------------------------------------- |
| `src/chat/telegram/index.ts` | Extract `video.thumbnail` file_id, download as JPEG                         |
| `src/llm-orchestrator.ts`    | Build multi-part content: `[ImagePart(thumbnail), TextPart(transcription)]` |

Requires a vision-capable model. Graceful degradation: skip thumbnail if model doesn't support images.

#### Phase 2c: Full frame extraction (requires ffmpeg)

Extract multiple frames at key intervals for richer visual understanding.

| File                      | Change                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `src/video-processing.ts` | New: ffmpeg-based frame extraction utility                        |
| `src/llm-orchestrator.ts` | Build multi-part content with multiple `ImagePart` frames         |
| `src/bot.ts`              | Detect ffmpeg availability, fall back to thumbnail if unavailable |

**Recommended frame extraction strategy:**

- Short videos (<30s): 1 frame every 5 seconds (max 6 frames)
- Longer videos (30s-2min): 1 frame every 15 seconds (max 8 frames)
- Very long videos (>2min): first frame + last frame + 4 evenly spaced (max 6 frames)
- Always include first and last frame

**ffmpeg availability detection:**

```typescript
async function isFFmpegAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['ffmpeg', '-version'], { stdout: 'ignore', stderr: 'ignore' })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}
```

**Recommendation:** Implement 2a first (trivial), then 2b (low effort, high value for screen recordings), then 2c only if users request richer video understanding.

### Phase 3: Native Multimodal (Future)

**Scope:** For users with multimodal-capable models, send audio/video directly as `FilePart`.

**Gated by:** A new config key `multimodal_mode: 'transcribe' | 'native'` (default: `transcribe`).

**Changes:**

- In `src/llm-orchestrator.ts`, when `multimodal_mode === 'native'`, build multi-part content instead of transcribing
- Replace binary data with text placeholder before storing in history
- Add token budget awareness for media parts in trimming logic

## Responding with Audio/Video

### Text-to-Speech (TTS) Responses

The bot could optionally respond with voice messages instead of text.

**OpenAI TTS API:**

```typescript
const response = await fetch(`${baseUrl}/v1/audio/speech`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'tts-1', input: text, voice: 'alloy' }),
})
const audioBuffer = await response.arrayBuffer()
```

**Telegram voice reply:**

```typescript
import { InputFile } from 'grammy'
await ctx.replyWithVoice(new InputFile(new Uint8Array(audioBuffer), 'response.ogg'))
```

**When to use TTS:**

- Only when the user sent a voice message (mirror the input modality)
- Controlled by config: `tts_enabled: true/false`, `tts_voice: 'alloy' | 'echo' | ...`
- Always include text as caption for accessibility

**New config keys:**

- `tts_enabled` — Enable voice responses (default: `false`)
- `tts_baseurl` — TTS API base URL
- `tts_apikey` — TTS API key
- `tts_model` — TTS model (default: `tts-1`)
- `tts_voice` — Voice selection (default: `alloy`)

**Implementation:** Add `voice` method to `ReplyFn`:

```typescript
export type ReplyFn = {
  // ... existing methods
  voice?: (audio: Uint8Array, caption?: string, options?: ReplyOptions) => Promise<void>
}
```

### Video Responses

Not recommended. The bot is text/task-oriented. Generating video responses would require:

- Video generation models (expensive, slow)
- No clear use case for task management

## Mattermost Considerations

Mattermost doesn't have native voice/video messages in the same way as Telegram, but users can attach audio/video files. The same transcription pipeline applies:

1. Extend `MattermostPostSchema` to include `file_ids`
2. On incoming post, check file metadata for audio/video MIME types
3. Download and transcribe audio/video attachments
4. Process as text

## Cost & Performance Estimates

| Operation                                  | Latency   | Cost                               |
| ------------------------------------------ | --------- | ---------------------------------- |
| Download voice note (Telegram, ~30s audio) | 100-300ms | Free                               |
| Whisper transcription (30s audio)          | 1-3s      | ~$0.003 (OpenAI) / ~$0.0002 (Groq) |
| TTS response (100 words)                   | 500ms-1s  | ~$0.003 (OpenAI)                   |
| LLM processing (text, as today)            | 2-5s      | Varies by provider                 |

**Total added latency for voice→text→voice round trip:** ~3-6s on top of normal LLM processing.

## Summary

| Phase    | Scope                                    | Complexity              | Dependencies                       |
| -------- | ---------------------------------------- | ----------------------- | ---------------------------------- |
| Phase 1  | Voice/audio → transcribe → text          | Medium                  | STT API (OpenAI-compatible)        |
| Phase 2a | Video → transcribe audio track           | Low (on top of Phase 1) | Same STT API (Whisper handles mp4) |
| Phase 2b | Video → thumbnail + transcription        | Low                     | Vision-capable LLM                 |
| Phase 2c | Video → frame extraction + transcription | Medium                  | ffmpeg + vision-capable LLM        |
| Phase 3  | Native multimodal audio/video to LLM     | High                    | `@ai-sdk/google` or multimodal LLM |
| TTS      | Text → voice response                    | Medium                  | TTS API (OpenAI-compatible)        |

**Recommended starting point:** Phase 1 (voice transcription) → Phase 2a (video audio, trivial extension) → Phase 2b (thumbnail vision, high value for screen recordings).
