// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { openCodeError } from './errors.js'

/**
 * The contract with `@opencode-ai/sdk`, as recorded rather than assumed.
 *
 * Split out of the adapter when progress reporting pushed that file past
 * `max-lines`, and the seam was already there: this file is what the SDK says,
 * the adapter is what the pipeline does with it. They move for different
 * reasons — one on an SDK upgrade, the other on a pipeline change.
 *
 * The fixtures in `adapters.test.ts` come from a live `opencode serve` 1.18.7
 * driven through this pipeline's own generated config. When the pin moves,
 * re-run `bun run opencode-agent:test:live` and re-record them; do not adjust
 * these decoders by inspection.
 */

interface TextLike {
  type?: string
  text?: string
}

/** Concatenates the text parts of an assistant reply, ignoring tool/file parts. */
export const collectText = (parts: readonly unknown[] | undefined): string => {
  if (parts === undefined) return ''

  const chunks: string[] = []
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as TextLike
    if (candidate.type !== 'text') continue
    if (typeof candidate.text === 'string' && candidate.text.length > 0) chunks.push(candidate.text)
  }

  return chunks.join('\n').trim()
}

/**
 * The SDK client's response envelope.
 *
 * Exported because these decoders *are* the contract with the SDK, and they sit
 * on the one path a `connect` seam cannot reach — which is exactly how they came
 * to be untested guesses in the first place.
 *
 * This is not a guess. The generated client returns
 * `RequestResult<…, ThrowOnError = false, ResponseStyle = "fields">`, i.e.
 * `{ data, error, request, response }` — it does not throw on a non-2xx, it
 * reports through `error`. Verified against a live `opencode serve`: a created
 * session answers `{ data: { id: "ses_…" }, request, response }` with `error`
 * undefined, and a prompt answers `{ data: { parts: [...] }, … }`.
 *
 * Decoding through a schema rather than probing for whichever field happens to
 * exist means an SDK upgrade that moves the payload fails here, naming the
 * contract, instead of yielding empty text that surfaces three layers away as
 * "the model returned no JSON".
 */
const sessionResponseSchema = z.object({
  data: z.object({ id: z.string().min(1) }).optional(),
  error: z.unknown().optional(),
})

const promptResponseSchema = z.object({
  data: z.object({ parts: z.array(z.unknown()).default([]) }).optional(),
  error: z.unknown().optional(),
})

const rejectEnvelopeError = (error: unknown, action: string): void => {
  if (error === undefined || error === null) return
  throw openCodeError(`OpenCode rejected the ${action}: ${JSON.stringify(error)}`)
}

export const decodeReply = (reply: unknown): string => {
  const parsed = promptResponseSchema.safeParse(reply)
  if (!parsed.success) {
    throw openCodeError(`Unexpected prompt response from the OpenCode SDK: ${parsed.error.message}`)
  }

  rejectEnvelopeError(parsed.data.error, 'prompt')
  if (parsed.data.data === undefined) throw openCodeError('OpenCode returned a prompt response with no data')

  // A reply carries step-start / text / step-finish parts; only text is content.
  return collectText(parsed.data.data.parts)
}

export const decodeSessionId = (created: unknown): string => {
  const parsed = sessionResponseSchema.safeParse(created)
  if (!parsed.success) {
    throw openCodeError(`Unexpected session response from the OpenCode SDK: ${parsed.error.message}`)
  }

  rejectEnvelopeError(parsed.data.error, 'session creation')
  if (parsed.data.data === undefined) throw openCodeError('OpenCode returned a session response with no id')

  return parsed.data.data.id
}
