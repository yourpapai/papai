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
