// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * What one OpenCode event means, and what of it may be said out loud.
 *
 * Split from `progress.ts` when reporting outgrew one file: this decides what
 * an event *is*, that one decides what to *do* about it. The split matters
 * beyond line count — the containment rule below lives here, on the decoders,
 * where it is a property of the types rather than a habit of the callers.
 *
 * **Nothing here carries content.** Not tool input, not tool output, not the
 * model's text. That is enforced by the schemas rather than by care: each names
 * the scalar fields it wants and Zod drops the rest, so `state.input` (a `bash`
 * command, a file's new contents) and `state.output` (an entire file) have
 * nowhere to land. A CI log is world-readable on a public repository and is not
 * covered by the outbound redaction that guards issue comments, so the safe
 * rule is structural: names, statuses and counts only.
 *
 * The shapes are **recorded**, not guessed — read off a live `opencode serve`
 * 1.18.7 driven through this pipeline's own config. Worth knowing that the
 * SDK's generated `Event` union is already behind its own server: the running
 * server emits `message.part.delta`, which the union does not list. That is why
 * every decode here is a `safeParse` yielding `null` on a miss rather than a
 * validation error — an unknown event is normal, and must never be able to fail
 * a phase that was otherwise going fine.
 */

/** One thing worth saying about a running turn. */
export interface Activity {
  /**
   * Which of the three event families this came from.
   *
   * Carried rather than inferred: `progress.ts` renders a tool, a step and a
   * session status to three different line shapes, and re-deriving the family
   * from which meta keys happen to be present is exactly the guesswork
   * `summary` and `collapseKey` were named to avoid.
   */
  kind: 'tool' | 'step' | 'status' | 'failure'
  message: string
  /** Structural only: names, statuses, counts. Never model or tool content. */
  meta: Record<string, string | number>
  /**
   * The one-phrase form, for the heartbeat to quote.
   *
   * Carried rather than reconstructed. Reading it back out of `meta` by key
   * name means every new kind of activity silently falls through to a generic
   * label — a finished step reported as "thinking" — and nothing says so.
   */
  summary: string
  /** What this contributes to the running totals. */
  counts?: { toolCalls?: number; tokens?: number; cost?: number }
  /**
   * Set when consecutive activities with the same key say the same thing, and
   * only the first is worth a line.
   *
   * Named by the producer for the same reason `summary` is. Inferring it — "an
   * activity with a `status` in its metadata and no counts must be a session
   * status" — quietly swept up tool calls too, which also carry a status, and
   * would have collapsed two identical tool calls into one.
   */
  collapseKey?: string
}

/**
 * A tool call changing state.
 *
 * `state` deliberately declares only `status`. The real payload also carries
 * `input` and `output` — the command being run, the file being written, the
 * whole contents of a file that was read — and this is the seam that keeps them
 * out of the log.
 */
const toolEvent = z.object({
  type: z.literal('message.part.updated'),
  properties: z.object({
    sessionID: z.string(),
    part: z.object({
      type: z.literal('tool'),
      tool: z.string(),
      callID: z.string(),
      state: z.object({ status: z.string() }),
    }),
  }),
})

/**
 * The end of one model step, which is where the accounting lives.
 *
 * Not a cost *ceiling* — that is S5-6 and this does not close it. It is the
 * cheaper half: knowing what a run spent, per step, without reading it off a
 * provider dashboard afterwards.
 */
const stepEvent = z.object({
  type: z.literal('message.part.updated'),
  properties: z.object({
    sessionID: z.string(),
    part: z.object({
      type: z.literal('step-finish'),
      tokens: z.object({ input: z.number(), output: z.number(), reasoning: z.number() }),
      cost: z.number(),
    }),
  }),
})

/**
 * Session state. The `retry` variant carries the provider's own message, which
 * is not decoded: the attempt number says the same thing without quoting text
 * this pipeline did not write.
 */
const statusEvent = z.object({
  type: z.literal('session.status'),
  properties: z.object({
    sessionID: z.string(),
    status: z.object({ type: z.string(), attempt: z.number().optional() }),
  }),
})

const describeTool = (event: unknown, sessionId: string): Activity | null => {
  const parsed = toolEvent.safeParse(event)
  if (!parsed.success || parsed.data.properties.sessionID !== sessionId) return null

  const { part } = parsed.data.properties
  // `pending` is the placeholder emitted before the arguments have even
  // arrived, and adds a line per tool call that says nothing.
  if (part.state.status === 'pending') return null

  return {
    kind: 'tool',
    message: 'Model tool call',
    meta: { tool: part.tool, status: part.state.status, call: part.callID },
    summary: `${part.tool} (${part.state.status})`,
    // Counted when it starts, not again when it finishes.
    counts: { toolCalls: part.state.status === 'running' ? 1 : 0 },
  }
}

const describeStep = (event: unknown, sessionId: string): Activity | null => {
  const parsed = stepEvent.safeParse(event)
  if (!parsed.success || parsed.data.properties.sessionID !== sessionId) return null

  const { tokens, cost } = parsed.data.properties.part
  return {
    kind: 'step',
    message: 'Model step finished',
    meta: { inputTokens: tokens.input, outputTokens: tokens.output, reasoningTokens: tokens.reasoning, cost },
    summary: 'finished a step',
    counts: { tokens: tokens.input + tokens.output, cost },
  }
}

/**
 * The session saying the provider would not serve it.
 *
 * Recorded from the 1.18.7 types: `session.error` carries a named error whose
 * `data` differs per name, of which `message` and `statusCode` are the only
 * fields more than one of them shares.
 *
 * **The message is deliberately not taken.** That is the containment rule this
 * module exists to hold, and this is the event that most tempts a widening: a
 * provider's error text is the natural place for a rejected credential to be
 * quoted back, and a CI log on a public repository is world-readable and is not
 * covered by the outbound redaction that guards issue comments. The name and
 * the status code are a status and a number — they distinguish a 429 that will
 * pass from a 401 that will not, which is the whole of what a maintainer needs
 * from this line — and neither can carry a secret.
 *
 * `statusCode` is optional in the type and stays optional here: `UnknownError`
 * and `MessageAbortedError` carry none, and an absent code must read as absent
 * rather than as a zero.
 */
const errorEvent = z.object({
  type: z.literal('session.error'),
  properties: z.object({
    sessionID: z.string().optional(),
    error: z.object({ name: z.string(), data: z.object({ statusCode: z.number().optional() }).optional() }),
  }),
})

const describeError = (event: unknown, sessionId: string): Activity | null => {
  const parsed = errorEvent.safeParse(event)
  if (!parsed.success) return null

  // `sessionID` is optional on this event alone, and an error the server could
  // not attribute is still this run's — there is one session per job.
  const { sessionID, error } = parsed.data.properties
  if (sessionID !== undefined && sessionID !== sessionId) return null

  const statusCode = error.data?.statusCode
  return {
    kind: 'failure',
    message: 'Model provider failure',
    meta: statusCode === undefined ? { error: error.name } : { error: error.name, statusCode },
    summary: statusCode === undefined ? error.name : `${error.name} (${statusCode})`,
  }
}

const describeStatus = (event: unknown, sessionId: string): Activity | null => {
  const parsed = statusEvent.safeParse(event)
  if (!parsed.success || parsed.data.properties.sessionID !== sessionId) return null

  const { status } = parsed.data.properties
  const attempt = status.attempt
  return {
    kind: 'status',
    message: 'Model session status',
    meta: attempt === undefined ? { status: status.type } : { status: status.type, attempt },
    summary: status.type,
    collapseKey: status.type,
  }
}

/**
 * Decodes one raw event into something worth logging, or `null`.
 *
 * `null` covers three different things on purpose — an event for another
 * session, an event this pipeline has no opinion about (`plugin.added` fires
 * forty-five times per boot), and an event whose shape has moved since 1.18.7.
 * All three mean the same thing to the caller: say nothing and carry on.
 */
export const describeActivity = (event: unknown, sessionId: string): Activity | null =>
  describeTool(event, sessionId) ??
  describeStep(event, sessionId) ??
  describeStatus(event, sessionId) ??
  describeError(event, sessionId)
