// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * The contract with the `claude` CLI, as recorded rather than assumed — the
 * `sdk-contract.ts` doctrine carried to the second backend. This file is what
 * the CLI **says** (the NDJSON line schemas); the argv half it is **asked**
 * lives in `claude-argv.ts` (split when this file reached `max-lines`),
 * `claude-connect.ts` is how it is started and addressed, and
 * `claude-adapter.ts` is the session the pipeline holds. They change for the
 * same reasons their twins do.
 *
 * The line shapes come from the fixture corpus under
 * `tests/opencode-agent/fixtures/claude-cli/` — its README records the
 * provenance of each file. When the pinned CLI version moves, re-run
 * `bun run opencode-agent:test:claude-live` and re-record rather than
 * adjusting a decoder by inspection.
 */

/** Token usage as the CLI's `result` line reports it. `total` is every bucket summed. */
export interface ClaudeUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  total: number
}

/** One decoded NDJSON line, reduced to the scalars the pipeline may consume. */
export type ClaudeStreamLine =
  | { readonly kind: 'init'; readonly sessionId: string; readonly apiKeySource: string | null }
  | { readonly kind: 'assistant'; readonly tools: readonly string[] }
  | { readonly kind: 'tool-results'; readonly succeeded: number; readonly failed: number }
  | { readonly kind: 'stream-event'; readonly tool: string | null }
  | {
      readonly kind: 'result'
      readonly isError: boolean
      readonly text: string
      readonly sessionId: string
      readonly usage: ClaudeUsage
      readonly costUsd: number
    }
  | ({ readonly kind: 'rate-limit-event' } & RateLimitFact)

/**
 * The init line: the stream's first line, and the only session-id source.
 *
 * Narrow on purpose — the recorded init line carries a dozen more fields
 * (slash commands, plugins, capabilities), none of which the pipeline reads,
 * so none of which the schema names. The one exception is `apiKeySource`,
 * the credential-source fact: it is the recorded proof of which carrier the
 * CLI consulted (`"none"` under `--bare` with an env OAuth token — the fact
 * behind the helper route) and the OAuth leg's recording reads it back. A
 * `system` line of another subtype (`compact_boundary`, say) skips, like
 * every unrecognized shape.
 */
const initLineSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string().min(1),
  apiKeySource: z.string().optional(),
})

/**
 * One rate-limit window as the pipeline reads it.
 *
 * `window` is a pass-through string, never enumerated: the corpus carries
 * `five_hour` and `seven_day`, and other plans carry windows this decoder has no
 * business refusing.
 *
 * `utilization` is the consumed share as a 0–1 fraction, straight from the
 * provider. The *remaining* percentage a reader wants is its complement, and
 * that subtraction lives at the render rather than here — a decoder that
 * published a derived figure would make it impossible to tell, later, whether
 * the provider stated it or we computed it.
 */
export interface RateLimitWindow {
  readonly window: string
  readonly utilization?: number
  readonly resetsAt?: number
}

/** The account-level standing, plus every window the line named. */
export interface RateLimitFact {
  readonly windows: readonly RateLimitWindow[]
  readonly status?: string
  readonly overageStatus?: string
  readonly overageResetsAt?: number
  readonly isUsingOverage?: boolean
}

/**
 * The subscription rate-limit fact.
 *
 * Recorded on two CLI versions, and the newer one is a **break** rather than an
 * addition. 2.1.239 (`native-success-turn.ndjson`) named one window at the top
 * level as `rateLimitType` and published no figure for it. 2.1.251
 * (`stub-rate-limit-turn.ndjson`) carries **no `rateLimitType` at all** and puts
 * the figures in `unifiedWindows` — so the schema this file used to have, which
 * required `rateLimitType`, does not lose a field against the newer CLI: it
 * fails the line and skips the whole fact. A rate-limit render over that schema
 * would report nothing at all while looking correctly implemented.
 *
 * Hence: every field optional and lenient, and `windows` assembled from whichever
 * shape arrived. `unifiedWindows` describes itself `@internal` in the CLI's own
 * schema, which is the argument for leniency rather than against reading it — a
 * moved field must cost that field and never the account-level fact beside it,
 * the same rule `ModelEntrySchema` records one workspace over.
 *
 * The line remains optional evidence: a stream without one decodes fine, and it
 * is still the native profile's proof of authentication (design D4) because
 * `apiKeySource` reads `none` on that path.
 */
const windowFigureSchema = z
  .object({ utilization: z.number().optional().catch(undefined), resetsAt: z.number().optional().catch(undefined) })
  .optional()
  .catch(undefined)

const rateLimitLineSchema = z.object({
  type: z.literal('rate_limit_event'),
  rate_limit_info: z.object({
    rateLimitType: z.string().min(1).optional().catch(undefined),
    status: z.string().optional().catch(undefined),
    resetsAt: z.number().optional().catch(undefined),
    utilization: z.number().optional().catch(undefined),
    overageStatus: z.string().optional().catch(undefined),
    overageResetsAt: z.number().optional().catch(undefined),
    isUsingOverage: z.boolean().optional().catch(undefined),
    unifiedWindows: z.record(z.string(), windowFigureSchema).optional().catch(undefined),
  }),
})

/**
 * The windows a line named, newest shape first.
 *
 * `unifiedWindows` wins when present because it is the shape that carries
 * figures; the top-level `rateLimitType` is the older CLI's single unfigured
 * window and is read only when nothing richer arrived. A line naming neither has
 * no window to report, which is not an error — the account-level status on it is
 * still worth decoding.
 */
const windowsOf = (info: z.infer<typeof rateLimitLineSchema>['rate_limit_info']): RateLimitWindow[] => {
  const unified = Object.entries(info.unifiedWindows ?? {}).flatMap(([window, figure]) =>
    figure === undefined
      ? [{ window }]
      : [
          {
            window,
            ...(figure.utilization === undefined ? {} : { utilization: figure.utilization }),
            ...(figure.resetsAt === undefined ? {} : { resetsAt: figure.resetsAt }),
          },
        ],
  )
  if (unified.length > 0) return unified
  if (info.rateLimitType === undefined) return []
  return [
    {
      window: info.rateLimitType,
      ...(info.utilization === undefined ? {} : { utilization: info.utilization }),
      ...(info.resetsAt === undefined ? {} : { resetsAt: info.resetsAt }),
    },
  ]
}

/** A content block reduced to its shape and, for tool calls, its name. */
const blockSchema = z.object({ type: z.string(), name: z.string().optional() })

const assistantLineSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({ content: z.array(blockSchema).optional() }).optional(),
})

/** A tool result block: the completion status of a call, without its content. */
const resultBlockSchema = z.object({ type: z.string(), is_error: z.boolean().optional() })

const userLineSchema = z.object({
  type: z.literal('user'),
  message: z.object({ content: z.array(resultBlockSchema).optional() }).optional(),
})

const streamEventLineSchema = z.object({
  type: z.literal('stream_event'),
  event: z.object({ content_block: blockSchema.optional() }).optional(),
})

const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
})

const resultLineSchema = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string(),
  session_id: z.string().min(1),
  usage: usageSchema,
  total_cost_usd: z.number().default(0),
})

/**
 * The whole fact one rate-limit line carries, assembled from whichever shape
 * arrived.
 *
 * Its own function because {@link decodeClaudeLine} is a dispatch table and this
 * is the one branch with assembly in it — inlined, it pushed that function past
 * `max-lines-per-function`, which is the seam declaring itself.
 */
const rateLimitFactOf = (
  info: z.infer<typeof rateLimitLineSchema>['rate_limit_info'],
): Extract<ClaudeStreamLine, { kind: 'rate-limit-event' }> => ({
  kind: 'rate-limit-event',
  windows: windowsOf(info),
  ...(info.status === undefined ? {} : { status: info.status }),
  ...(info.overageStatus === undefined ? {} : { overageStatus: info.overageStatus }),
  ...(info.overageResetsAt === undefined ? {} : { overageResetsAt: info.overageResetsAt }),
  ...(info.isUsingOverage === undefined ? {} : { isUsingOverage: info.isUsingOverage }),
})

/**
 * Decodes one NDJSON line, or `null` when its shape is not recognized.
 *
 * `null` never fails the turn — the `activity.ts` doctrine: a line the pin
 * does not know is skipped for progress purposes, and only the `result` line's
 * absence or error signalling (which the adapter, not this decoder, judges)
 * ends a turn badly.
 */
export const decodeClaudeLine = (raw: unknown): ClaudeStreamLine | null => {
  const init = initLineSchema.safeParse(raw)
  if (init.success)
    return { kind: 'init', sessionId: init.data.session_id, apiKeySource: init.data.apiKeySource ?? null }

  const rateLimit = rateLimitLineSchema.safeParse(raw)
  if (rateLimit.success) return rateLimitFactOf(rateLimit.data.rate_limit_info)

  const assistant = assistantLineSchema.safeParse(raw)
  if (assistant.success) {
    const blocks = assistant.data.message?.content ?? []
    return { kind: 'assistant', tools: blocks.flatMap((block) => (block.name === undefined ? [] : [block.name])) }
  }

  const user = userLineSchema.safeParse(raw)
  if (user.success) {
    const blocks = user.data.message?.content ?? []
    const failed = blocks.filter((block) => block.is_error === true).length
    return { kind: 'tool-results', succeeded: blocks.length - failed, failed }
  }

  const streamEvent = streamEventLineSchema.safeParse(raw)
  if (streamEvent.success) {
    return { kind: 'stream-event', tool: streamEvent.data.event?.content_block?.name ?? null }
  }

  const result = resultLineSchema.safeParse(raw)
  if (!result.success) return null
  const usage = result.data.usage
  return {
    kind: 'result',
    isError: result.data.is_error,
    text: result.data.result,
    sessionId: result.data.session_id,
    usage: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      cacheRead: usage.cache_read_input_tokens,
      total:
        usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    },
    costUsd: result.data.total_cost_usd,
  }
}

/** Splits a stream into parsed lines, skipping blanks and undecodable JSON. */
export const parseNdjsonStream = (text: string): unknown[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        return []
      }
    })
