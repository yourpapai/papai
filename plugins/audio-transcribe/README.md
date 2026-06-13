# Audio Transcribe

> Plugin ID: `audio-transcribe` · Version: 2.1.0 · `defaultEnabled: false`

Transcribes voice notes automatically before the LLM turn and transcribes audio
file attachments on demand, via an OpenAI-compatible
`POST /v1/audio/transcriptions` endpoint (OpenAI Whisper, Groq, or any
compatible service).

## Contributions

| Surface                | Name                    | Notes                                                                                   |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Tool                   | `transcribe`            | On-demand transcription of an audio attachment by `attachment_id` (optional `language`) |
| Prompt fragment        | `audio-transcribe-hint` | Tells the agent voice notes are pre-transcribed and when to call `transcribe`           |
| Attachment transformer | `audio-transcribe`      | Auto-transcribes incoming voice notes before the LLM turn                               |

The attachment transformer runs only for attachments whose MIME type starts
with `audio/` (or whose filename ends in `.ogg`, `.opus`, `.mp3`, `.m4a`,
`.wav`, `.webm`) and whose origin is `voice`. Auto-transcribed text is injected
inline as `[Voice attachment att_<id> …: "…"]`. The `transcribe` tool covers
the explicit case — an attached audio **file** the user asks to transcribe, or
re-transcription with an explicit `language`.

## Permissions

`http`, `attachments.read`, `storage`.

## Allowed hosts

`api.openai.com`, `api.groq.com`, plus the host derived from the configured
`base_url` (`providerAllowedHostsFromConfig`). Every outbound hop must pass the
runtime public-URL checks.

## Configuration

Both **admin** (deployment-wide) and **context** (per personal/group context)
scopes are supported. A context override of `api_key` and `base_url` must be set
**together or not at all** — setting only one returns
`incomplete_context_override`.

| Key        | Scope           | Required | Sensitive | Default                  | Description                            |
| ---------- | --------------- | -------- | --------- | ------------------------ | -------------------------------------- |
| `api_key`  | admin / context | No\*     | Yes       | —                        | Bearer token for the transcription API |
| `base_url` | admin / context | No       | No        | `https://api.openai.com` | OpenAI-compatible base URL             |
| `model`    | admin / context | No       | No        | `whisper-1`              | Transcription model                    |

\* Not enforced by the manifest, but transcription returns `not_configured`
until an `api_key` is set. Context `model` overrides admin `model`.

## Behavior notes

- **Caching** — transcripts are cached in plugin KV keyed by attachment id;
  repeat `transcribe` calls and re-renders are free. Cache entries older than 30
  days are pruned on write.
- **Limits** — audio over 24 MiB returns `audio_too_large`. The transformer has
  a 60 s timeout (`activationTimeoutMs` for activation is 3000 ms).
- **Rate limiting** — checked per storage context before the network call.
- **Failure handling** — failures surface as structured tool errors
  (`not_configured`, `rate_limited`, `attachment_not_found`,
  `unsupported_media_type`, `timeout`, `api_error`, …); for the transformer they
  become a human-readable in-turn marker line, never breaking the turn.

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), then
enable it per context. Set at least an `api_key` (admin scope) for transcription
to function.
