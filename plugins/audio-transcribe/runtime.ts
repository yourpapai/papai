// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { PluginContext } from '../../src/plugins/context.js'
import type { AttachmentTransformResult, PluginToolRuntimeContext } from '../../src/plugins/types.js'
import {
  AUDIO_EXTENSIONS,
  buildCacheKey,
  describeApiFailure,
  describeLoadFailure,
  loadAudioAttachment,
  normalizeLanguage,
  readCachedTranscript,
  resolveConfig,
  transcribeRecord,
  writeCache,
  type HttpFetch,
  type TranscribeResult,
} from './transcription.js'

type RuntimeLogger = PluginContext['log']

/** Persist a transcript and warn (rather than silently swallow) on KV failure. */
const persistTranscript = (
  runtimeContext: PluginToolRuntimeContext,
  cacheKey: string,
  result: TranscribeResult,
  log: RuntimeLogger,
): void => {
  if (!writeCache(runtimeContext.kv, cacheKey, result)) {
    log.warn(
      { cacheKey, storageContextId: runtimeContext.storageContextId },
      'audio-transcribe: failed to persist transcript to cache — future turns will re-transcribe',
    )
  }
}

const transcribeInputSchema = z.object({
  attachment_id: z.string().min(1).max(200),
  language: z.string().min(2).max(8).optional(),
})

const parseTranscribeInput = (
  input: unknown,
): z.infer<typeof transcribeInputSchema> | { error: string; message: string } => {
  try {
    return transcribeInputSchema.parse(input)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: 'validation_error', message: err.message }
    }
    throw err
  }
}

const toTransformResult = (result: TranscribeResult): AttachmentTransformResult => ({
  ok: true as const,
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

async function executeTranscribe(
  input: unknown,
  runtimeContext: PluginToolRuntimeContext,
  httpFetch: HttpFetch | undefined,
  log: RuntimeLogger,
): Promise<unknown> {
  const parsed = parseTranscribeInput(input)
  if ('error' in parsed) return parsed

  // A language-specific request gets its own cache key so an explicit
  // re-transcription re-runs instead of returning a stale base transcript.
  const language = normalizeLanguage(parsed.language)
  const cacheKey = buildCacheKey(parsed.attachment_id, language)
  const cached = readCachedTranscript(runtimeContext.kv, cacheKey)
  if (cached !== undefined) return cached

  // Resolve config and check for missing or incomplete config before consuming rate-limit quota.
  // A misconfigured deployment must report not_configured or incomplete_context_override, not rate_limited.
  const config = resolveConfig(runtimeContext)
  if (!config.ok) {
    return {
      error: 'incomplete_context_override',
      message: 'set both api_key and base_url in this context, or clear both',
    }
  }
  if (config.apiKey === undefined || config.apiKey.trim() === '' || httpFetch === undefined) {
    return { error: 'not_configured', message: 'audio-transcribe: api_key missing or providerRuntime unavailable' }
  }

  // Key the quota per-user (chatUserId), not per storage context: in a group the
  // storage context is shared, so context-keying would let one chatty voice user
  // exhaust the whole group's transcription budget.
  const rateResult = runtimeContext.rateLimit.check(runtimeContext.chatUserId)
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const audio = await loadAudioAttachment(runtimeContext, parsed.attachment_id)
  if (!audio.ok) return audio.result

  log.debug({ attachmentId: parsed.attachment_id, language }, 'audio-transcribe: transcribing (cache miss)')
  const apiResult = await transcribeRecord(audio.record, audio.bytes, language, config, httpFetch)
  if ('error' in apiResult) return apiResult

  persistTranscript(runtimeContext, cacheKey, apiResult, log)
  return apiResult
}

async function runTransform(
  record: { attachmentId: string },
  runtimeContext: PluginToolRuntimeContext,
  httpFetch: HttpFetch | undefined,
  log: RuntimeLogger,
): Promise<AttachmentTransformResult> {
  const cacheKey = buildCacheKey(record.attachmentId)
  const cached = readCachedTranscript(runtimeContext.kv, cacheKey)
  if (cached !== undefined) return toTransformResult(cached)

  // Resolve config and check for missing or incomplete config before consuming rate-limit quota.
  // A misconfigured deployment must report not configured or incomplete context override, not rate limited.
  const config = resolveConfig(runtimeContext)
  if (!config.ok) {
    return {
      ok: false,
      reason: 'incomplete context override — set both api_key and base_url in this context, or clear both',
    }
  }
  if (config.apiKey === undefined || config.apiKey.trim() === '' || httpFetch === undefined) {
    return { ok: false, reason: 'not configured — the admin can set a transcription API key in the settings UI' }
  }

  // Key the quota per-user (chatUserId), not per storage context: in a group the
  // storage context is shared, so context-keying would let one chatty voice user
  // exhaust the whole group's transcription budget.
  const rateResult = runtimeContext.rateLimit.check(runtimeContext.chatUserId)
  if (!rateResult.allowed) return { ok: false, reason: 'rate limited — try again shortly' }

  const audio = await loadAudioAttachment(runtimeContext, record.attachmentId)
  if (!audio.ok) return { ok: false, reason: describeLoadFailure(audio.result) }

  log.debug({ attachmentId: record.attachmentId }, 'audio-transcribe: auto-transcribing voice note (cache miss)')
  const apiResult = await transcribeRecord(audio.record, audio.bytes, undefined, config, httpFetch)
  if ('error' in apiResult) return { ok: false, reason: describeApiFailure(apiResult) }

  persistTranscript(runtimeContext, cacheKey, apiResult, log)
  return toTransformResult(apiResult)
}

/**
 * Registers the transcribe tool, prompt fragment, and attachment transformer.
 *
 * This module is loaded via `import.meta.require('./runtime.js')` from the
 * entry point so its bare `zod` import stays out of the discovery scanner's
 * static entry graph (which forbids bare-module imports). See `index.ts`.
 */
export function registerAudioTranscribe(ctx: PluginContext): void {
  const httpFetch = ctx.providerRuntime?.httpFetch
  const log = ctx.log

  log.info({}, 'audio-transcribe plugin activated')

  ctx.registration.registerTool({
    name: 'transcribe',
    description:
      'Transcribes an audio attachment to text. Call this when the user asks to transcribe an audio file attachment, or to re-transcribe a voice note with an explicit language.',
    inputSchema: transcribeInputSchema,
    execute: (input: unknown, runtimeContext: PluginToolRuntimeContext) =>
      executeTranscribe(input, runtimeContext, httpFetch, log),
  })

  ctx.registration.registerPromptFragment({
    name: 'audio-transcribe-hint',
    content:
      'Voice notes are transcribed automatically: their text appears inline as `[Voice attachment att_<id> …: "…"]` lines. Call the transcribe tool only when (a) the user asks to transcribe an audio FILE attachment (lines like `[User attached att_<id>: song.mp3]`), or (b) a transcript is clearly wrong and the user names the spoken language — then pass `language`. Cached transcripts make repeat calls free.',
  })

  ctx.registration.registerAttachmentTransformer({
    name: 'audio-transcribe',
    mimePrefixes: ['audio/'],
    filenameExtensions: [...AUDIO_EXTENSIONS],
    origins: ['voice'],
    timeoutMs: 60_000,
    transform: (record, runtimeContext) => runTransform(record, runtimeContext, httpFetch, log),
  })
}
