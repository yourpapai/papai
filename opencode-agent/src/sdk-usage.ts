// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * The usage half of the OpenCode SDK contract — what a session has spent, and
 * how a tree of sessions sums. Split from `sdk-contract.ts` when that file
 * reached `max-lines`, along the seam its own doc comments had already drawn:
 * the envelope decoders are what the SDK *says*, this is what it *charged*,
 * read back from `session.get` rather than summed from events. They change for
 * the same reasons their claude twin does (`claude-usage.ts`).
 */

/**
 * A cache bucket, and the one field in this file that is deliberately **not**
 * `.default(0)`.
 *
 * `reasoning` beside it defaults and is right to: it is a count the budget adds
 * up, where "reported none" and "did not say" spend the same. A cache bucket
 * feeds the *price* instead, and there the two are different answers — cache
 * reads and writes are charged at their own rates, so a bucket the server never
 * reported cannot be priced at all. Defaulting it to `0` would quietly
 * under-charge a cache-heavy run rather than reporting it unpriced, which is
 * the failure this whole surface exists to avoid.
 *
 * `.catch(undefined)` for the same reason the decoder below returns `null`
 * rather than throwing: a moved field costs that field, never the whole read.
 */
const cacheBucketSchema = z.number().optional().catch(undefined)

const sessionUsageSchema = z.object({
  data: z
    .object({
      tokens: z.object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number().default(0),
        cache: z.object({ read: cacheBucketSchema, write: cacheBucketSchema }).optional().catch(undefined),
      }),
      cost: z.number().default(0),
    })
    .optional(),
  error: z.unknown().optional(),
})

export interface SessionUsage {
  /** Every counted bucket summed — what the token ceiling reads. */
  tokens: number
  cost: number
  /**
   * The same spend, unsummed, because the sum cannot be repriced: folding cache
   * reads and writes into one number loses the split their own rates need. Both
   * come from one read of one envelope, so the ceiling and the price cannot be
   * measured at different moments.
   */
  input: number
  output: number
  reasoning: number
  /** Absent when the server did not report the bucket — never conflated with `0`. */
  cacheRead?: number
  cacheWrite?: number
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
  return {
    tokens: Math.round(tokens.input + tokens.output + tokens.reasoning),
    cost,
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    ...(tokens.cache?.read === undefined ? {} : { cacheRead: tokens.cache.read }),
    ...(tokens.cache?.write === undefined ? {} : { cacheWrite: tokens.cache.write }),
  }
}

/**
 * Sums a session tree's accounts into one `SessionUsage` — the same shape one
 * `session.get` read answers, so the ceiling's scalar and the price ladder's
 * buckets read the tree exactly as they read a single session.
 *
 * The one rule the sum carries is `decodeSessionUsage`'s own: **absent is not
 * zero**. A cache bucket any summand leaves unreported stays absent on the
 * sum, because pricing a bucket one session never reported would under-charge
 * a cache-heavy tree while looking exact — `run-spend.ts` reads the absence
 * and reports the tree unpriced instead.
 */
export const sumSessionUsage = (usages: readonly SessionUsage[]): SessionUsage => {
  const bucket = (pick: (usage: SessionUsage) => number | undefined): number | undefined => {
    let sum = 0
    for (const usage of usages) {
      const value = pick(usage)
      if (value === undefined) return undefined
      sum += value
    }
    return sum
  }

  const cacheRead = bucket((usage) => usage.cacheRead)
  const cacheWrite = bucket((usage) => usage.cacheWrite)

  return {
    tokens: usages.reduce((sum, usage) => sum + usage.tokens, 0),
    cost: usages.reduce((sum, usage) => sum + usage.cost, 0),
    input: usages.reduce((sum, usage) => sum + usage.input, 0),
    output: usages.reduce((sum, usage) => sum + usage.output, 0),
    reasoning: usages.reduce((sum, usage) => sum + usage.reasoning, 0),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  }
}
