// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * The maintainer-only half of the event decoders.
 *
 * `activity.ts` decides what may be said in public — names, statuses and
 * counts, because a CI log is world-readable. This decodes the one tool
 * argument a maintainer debugging a run actually needs, and it exists to feed
 * exactly one consumer: the **encrypted** debug transcript in
 * `debug-transcript.ts`. It must never be wired into the public log, which is
 * why it is a separate module with its own schema rather than a widened field
 * on `Activity`.
 *
 * The whitelist is the containment rule, restated for a smaller audience. Per
 * tool, exactly one scalar field: a `bash` command, the path a file tool
 * touched, the pattern a search tool ran. Never the tool's *output* — an
 * entire file — never a file's new contents, and never the model's text. Those
 * are dropped structurally, the same way `activity.ts` drops them: the schema
 * names `input` as a record and the field table names the one key read out of
 * it, so everything else has nowhere to land.
 */

/** One line of the encrypted transcript. */
export interface TranscriptRow {
  /** When the activity was observed, ISO-8601. */
  time: string
  tool: string
  status: string
  /** The whitelisted argument, or `null` for a tool with none worth recording. */
  detail: string | null
  /** Running-to-finished wall clock, or `null` when the start was never seen. */
  durationMs: number | null
}

/** The detail one tool event contributes, identified by the call it belongs to. */
export interface ActivityDetail {
  tool: string
  callID: string
  detail: string | null
}

/** Longest argument the transcript keeps. A command can be a heredoc carrying
 *  a whole file; the transcript is a debugging aid, not a second working tree. */
const DETAIL_MAX_LENGTH = 200

/**
 * The one field each tool may contribute. Read through `Object.hasOwn`, never
 * `in`: the event is server-emitted JSON and `'toString' in` any object is
 * true — the same rule `types.ts` states for state blocks.
 */
const DETAIL_FIELDS: Record<string, string> = {
  bash: 'command',
  read: 'filePath',
  edit: 'filePath',
  write: 'filePath',
  grep: 'pattern',
  glob: 'pattern',
}

/**
 * `input` is declared as a record and no further. The real payload also
 * carries `output` beside it — the whole file a `read` returned — and this is
 * the seam that keeps it out, exactly as `activity.ts`'s is.
 */
const detailEvent = z.object({
  type: z.literal('message.part.updated'),
  properties: z.object({
    sessionID: z.string(),
    part: z.object({
      type: z.literal('tool'),
      tool: z.string(),
      callID: z.string(),
      state: z.object({ input: z.record(z.string(), z.unknown()).optional() }),
    }),
  }),
})

/** The whitelisted field, as a bounded string — or nothing, for anything else. */
const detailOf = (tool: string, input: Record<string, unknown> | undefined): string | null => {
  if (!Object.hasOwn(DETAIL_FIELDS, tool) || input === undefined) return null
  const field = DETAIL_FIELDS[tool]
  if (field === undefined) return null
  const value = input[field]
  return typeof value === 'string' ? value.slice(0, DETAIL_MAX_LENGTH) : null
}

/**
 * Decodes one raw event into the detail it may contribute to the encrypted
 * transcript, or `null`. The same three `null` cases as `describeActivity`:
 * another session, an event this pipeline has no opinion about, and a shape
 * that has moved since it was recorded.
 */
export const describeDetail = (event: unknown, sessionId: string): ActivityDetail | null => {
  const parsed = detailEvent.safeParse(event)
  if (!parsed.success || parsed.data.properties.sessionID !== sessionId) return null

  const { part } = parsed.data.properties
  return { tool: part.tool, callID: part.callID, detail: detailOf(part.tool, part.state.input) }
}

/**
 * The provider-side half: the failure text `session.status` retry and
 * `session.error` carry, decoded for the transcript alone.
 *
 * The 2026-08-21 incident is why this exists: the provider's own message was
 * the one account of what a dead gateway was doing — carried by these very
 * events, all 78 retries of them — and `activity.ts` dropped it at decode, so
 * no log, artifact or transcript anywhere named the cause. The public decoder
 * **still drops it**, by the containment rule that a provider's error text is
 * the natural place for a rejected credential to be quoted back into a
 * world-readable CI log; this is the one place content may go, and it goes
 * encrypted, with `redactSecrets` by value in front of the encryption.
 *
 * Both payload shapes are the pinned SDK's own — `status.message` on a retry,
 * `error.data.message` on a session error — re-verified against 1.18.16. The
 * name and status code stay public-side (`activity.ts` already decodes them);
 * the row here is the message and which of the two events it was.
 */
const retryDetailEvent = z.object({
  type: z.literal('session.status'),
  properties: z.object({
    sessionID: z.string(),
    status: z.object({
      type: z.literal('retry'),
      attempt: z.number().optional(),
      // `unknown` rather than `string`: a moved shape carrying an object under
      // `message` must read as no detail, not fail the row — the same rule the
      // tool field table applies to a non-scalar argument.
      message: z.unknown().optional(),
    }),
  }),
})

const errorDetailEvent = z.object({
  type: z.literal('session.error'),
  properties: z.object({
    // Optional here as in `activity.ts`'s decode: an error the server could
    // not attribute is still this run's — there is one session per job.
    sessionID: z.string().optional(),
    error: z.object({ data: z.object({ message: z.unknown().optional() }).optional() }),
  }),
})

/** The whitelisted provider text, bounded by the transcript's own size rule. */
const boundedText = (message: unknown): string | null =>
  typeof message === 'string' ? message.slice(0, DETAIL_MAX_LENGTH) : null

/**
 * Decodes one provider retry or session error into the transcript row it
 * earns, or `null` for anything else — including a retry or error about
 * another session.
 *
 * `status` is what the row shows beside the `provider` tool name, and carries
 * the attempt number the public log also prints, so the two accounts of one
 * incident can be lined up.
 */
export const describeProviderDetail = (
  event: unknown,
  sessionId: string,
): { status: string; detail: string | null } | null => {
  const retry = retryDetailEvent.safeParse(event)
  if (retry.success && retry.data.properties.sessionID === sessionId) {
    const { attempt, message } = retry.data.properties.status
    return { status: attempt === undefined ? 'retry' : `retry (attempt ${attempt})`, detail: boundedText(message) }
  }

  const failure = errorDetailEvent.safeParse(event)
  if (failure.success) {
    const { sessionID, error } = failure.data.properties
    if (sessionID !== undefined && sessionID !== sessionId) return null
    return { status: 'error', detail: boundedText(error.data?.message) }
  }

  return null
}
