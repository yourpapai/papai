// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { PluginContext } from '../../src/plugins/context.js'
import type { AttachmentTransformResult, PluginFactory, PluginToolRuntimeContext } from '../../src/plugins/types.js'
import {
  AUDIO_EXTENSIONS,
  describeApiFailure,
  describeLoadFailure,
  loadAudioAttachment,
  readCachedTranscript,
  resolveConfig,
  transcribeRecord,
  writeCache,
  type HttpFetch,
  type TranscribeResult,
} from './transcription.js'

const transcribeInputSchema = z.object({
  attachment_id: z.string().min(1).max(200),
  language: z.string().min(2).max(8).optional(),
})

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
): Promise<unknown> {
  let parsed: z.infer<typeof transcribeInputSchema>
  try {
    parsed = transcribeInputSchema.parse(input)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: 'validation_error', message: err.message }
    }
    throw err
  }

  const cacheKey = `transcript:${parsed.attachment_id}`
  const cached = readCachedTranscript(runtimeContext.kv, cacheKey)
  if (cached !== undefined) return cached

  // Resolve config and check for missing API key before consuming rate-limit quota.
  // A misconfigured deployment must report not_configured, not rate_limited.
  const { apiKey } = resolveConfig(runtimeContext)
  if (apiKey === undefined || apiKey.trim() === '' || httpFetch === undefined) {
    return { error: 'not_configured', message: 'audio-transcribe: api_key missing or providerRuntime unavailable' }
  }

  const rateResult = runtimeContext.rateLimit.check(runtimeContext.storageContextId)
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const audio = await loadAudioAttachment(runtimeContext, parsed.attachment_id)
  if (!audio.ok) return audio.result

  const apiResult = await transcribeRecord(audio.record, audio.bytes, parsed.language, runtimeContext, httpFetch)
  if ('error' in apiResult) return apiResult

  writeCache(runtimeContext.kv, cacheKey, apiResult)
  return apiResult
}

async function runTransform(
  record: { attachmentId: string },
  runtimeContext: PluginToolRuntimeContext,
  httpFetch: HttpFetch | undefined,
): Promise<AttachmentTransformResult> {
  const cacheKey = `transcript:${record.attachmentId}`
  const cached = readCachedTranscript(runtimeContext.kv, cacheKey)
  if (cached !== undefined) return toTransformResult(cached)

  // Resolve config and check for missing API key before consuming rate-limit quota.
  // A misconfigured deployment must report not configured, not rate limited.
  const { apiKey } = resolveConfig(runtimeContext)
  if (apiKey === undefined || apiKey.trim() === '' || httpFetch === undefined) {
    return { ok: false, reason: 'not configured — the admin can set a transcription API key in the settings UI' }
  }

  const rateResult = runtimeContext.rateLimit.check(runtimeContext.storageContextId)
  if (!rateResult.allowed) return { ok: false, reason: 'rate limited — try again shortly' }

  const audio = await loadAudioAttachment(runtimeContext, record.attachmentId)
  if (!audio.ok) return { ok: false, reason: describeLoadFailure(audio.result) }

  const apiResult = await transcribeRecord(audio.record, audio.bytes, undefined, runtimeContext, httpFetch)
  if ('error' in apiResult) return { ok: false, reason: describeApiFailure(apiResult) }

  writeCache(runtimeContext.kv, cacheKey, apiResult)
  return toTransformResult(apiResult)
}

const factory: PluginFactory = () => {
  let httpFetch: HttpFetch | undefined

  return {
    activate(ctx: PluginContext): void {
      httpFetch = ctx.providerRuntime?.httpFetch

      ctx.log.info({}, 'audio-transcribe plugin activated')

      ctx.registration.registerTool({
        name: 'transcribe',
        description:
          'Transcribes an audio attachment to text. Call this when the user asks to transcribe an audio file attachment, or to re-transcribe a voice note with an explicit language.',
        inputSchema: transcribeInputSchema,
        execute: (input: unknown, runtimeContext: PluginToolRuntimeContext) =>
          executeTranscribe(input, runtimeContext, httpFetch),
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
        transform: (record, runtimeContext) => runTransform(record, runtimeContext, httpFetch),
      })
    },

    deactivate(ctx: PluginContext): void {
      ctx.log.info({}, 'audio-transcribe plugin deactivated')
    },
  }
}

export default factory
