// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { openCodeError } from './errors.js'
import type { AgentPromptRequest } from './opencode-adapter.js'

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
 *
 * Requests as well as responses: the body shape the server expects is as much
 * of the contract as the envelope it answers with, and keeping the two in one
 * file is what makes a version bump a single place to look.
 */

/** `providerID/modelID`, e.g. `openai/gpt-5`. */
export interface ModelRef {
  providerID: string
  modelID: string
}

/**
 * Splits `provider/model` into the shape the SDK expects. Model ids may contain
 * slashes themselves (`openrouter/anthropic/claude-3.5`), so only the first
 * segment is treated as the provider.
 */
export const parseModelRef = (raw: string): ModelRef => {
  const separator = raw.indexOf('/')
  if (separator <= 0 || separator === raw.length - 1) {
    throw openCodeError(`Model must be "provider/model", got "${raw}"`)
  }
  return { providerID: raw.slice(0, separator), modelID: raw.slice(separator + 1) }
}

export interface SdkPromptBody {
  model: ModelRef
  agent?: string
  system?: string
  tools?: Record<string, boolean>
  parts: Array<{ type: 'text'; text: string }>
}

export const buildBody = (model: ModelRef, request: AgentPromptRequest): SdkPromptBody => ({
  model,
  parts: [{ type: 'text', text: request.prompt }],
  ...(request.agent === undefined ? {} : { agent: request.agent }),
  ...(request.system === undefined ? {} : { system: request.system }),
  ...(request.tools === undefined ? {} : { tools: request.tools }),
})

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

/**
 * What a session has spent so far, as the server itself accounts for it.
 *
 * Read back from `session.get` rather than summed from the event stream. Both
 * numbers exist and agree, but only this one is free of a race: a total summed
 * from events is whatever has arrived by the time it is asked for, and the
 * budget is checked immediately after a prompt returns. Verified against a real
 * server — two prompts of 1234/567 tokens each read back as exactly 2468/1134.
 *
 * `cost` is decoded and reported, never enforced on. It is derived from
 * OpenCode's model catalogue, and a model the catalogue does not price reports
 * the right token counts and a cost of **0**.
 */
const sessionUsageSchema = z.object({
  data: z
    .object({
      tokens: z.object({ input: z.number(), output: z.number(), reasoning: z.number().default(0) }),
      cost: z.number().default(0),
    })
    .optional(),
  error: z.unknown().optional(),
})

export interface SessionUsage {
  tokens: number
  cost: number
}

/**
 * Decodes a session's running totals.
 *
 * Unlike the other decoders here this one does **not** throw on a shape it does
 * not recognise. A budget is a guardrail on the work, not part of it, and an SDK
 * upgrade that moves these fields must not turn every phase into a failure. It
 * reports zero and says so at the call site, which is visible in the log and in
 * the totals the run reports.
 */
export const decodeSessionUsage = (fetched: unknown): SessionUsage | null => {
  const parsed = sessionUsageSchema.safeParse(fetched)
  if (!parsed.success || parsed.data.data === undefined) return null

  const { tokens, cost } = parsed.data.data
  return { tokens: Math.round(tokens.input + tokens.output + tokens.reasoning), cost }
}
