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
 * Whether the server accepted an abort.
 *
 * `POST /session/:id/abort` is declared `200: boolean` by the pinned SDK, and the
 * payload sits under `data` like every other response above — so the shape is the
 * recorded convention rather than a guess, and `live-sdk.integration.ts` checks
 * it against a running server along with the thing types cannot state: an abort
 * kills the running tool child and leaves the server up.
 *
 * This one throws on an unrecognised **shape** and reports `false` on a refusal,
 * which is the split that matters. Read as `false` for ever, an SDK that moved
 * this payload would silently turn every wall-clock stop into "nothing pushed" —
 * so the contract failure is loud. The adapter still catches it and answers
 * `false`, because a stop that cannot abort must post, park and hand over rather
 * than become a second failure.
 */
const abortResponseSchema = z.object({
  data: z.boolean().optional(),
  error: z.unknown().optional(),
})

export const decodeAbort = (aborted: unknown): boolean => {
  const parsed = abortResponseSchema.safeParse(aborted)
  if (!parsed.success) {
    throw openCodeError(`Unexpected abort response from the OpenCode SDK: ${parsed.error.message}`)
  }

  rejectEnvelopeError(parsed.data.error, 'abort')
  return parsed.data.data === true
}

/**
 * The children envelope: `GET /session/{id}/children` answers
 * `200: Array<Session>` under the same `{ data, error }` envelope every other
 * response here uses — the recorded convention applied to a list.
 *
 * Only `id` is read from each entry: the session-tree walk this feeds needs
 * addresses and nothing else. An entry whose `id` has moved or gone is dropped
 * whole — one bent child must not fail the list — and an unrecognised payload
 * reports `null` on the `decodeSessionUsage` doctrine: the walk decorates the
 * spend read, and an SDK that moved this list must not fail the turn or the
 * phase.
 */
const sessionChildSchema = z
  .object({ id: z.string().min(1) })
  .optional()
  .catch(undefined)

const sessionChildrenSchema = z.object({
  data: z.array(sessionChildSchema).optional().catch(undefined),
  error: z.unknown().optional(),
})

export const decodeSessionChildren = (fetched: unknown): readonly string[] | null => {
  const parsed = sessionChildrenSchema.safeParse(fetched)
  if (!parsed.success || parsed.data.data === undefined) return null

  return parsed.data.data.flatMap((entry) => (entry === undefined ? [] : [entry.id]))
}

/**
 * The usage half — the `session.get` account and the tree sum — lives in
 * `sdk-usage.ts`, split when this file reached `max-lines` again. Re-exported
 * so the contract's consumers keep naming this module for what the SDK says.
 */
export { decodeSessionUsage, sumSessionUsage } from './sdk-usage.js'
export type { SessionUsage } from './sdk-usage.js'
