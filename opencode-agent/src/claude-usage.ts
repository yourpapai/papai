// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * The usage half of the claude CLI contract — what one turn billed. Split
 * from `claude-contract.ts` when that file reached `max-lines`, along the
 * usage seam its own types had already drawn: the token buckets, the
 * per-model split and the per-bucket maximum that reads the complete figure
 * out of the two places the CLI reports usage. They change for the same
 * reasons their line-schema siblings do.
 */

/** Token usage as the CLI's `result` line reports it. `total` is every bucket summed. */
export interface ClaudeUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  total: number
}

/** One model's billed usage, renamed from the CLI's `modelUsage` entry. */
export interface ClaudeModelUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  costUsd?: number
}

export const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
})

/**
 * One `modelUsage` entry. The four token fields are the entry's identity: an
 * entry that renames or drops one is not an entry this decoder can vouch for
 * and is dropped whole, while `costUSD` — optional on the wire and absent from
 * the older recordings — costs only itself when bent.
 */
export const modelUsageEntrySchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheCreationInputTokens: z.number(),
    cacheReadInputTokens: z.number(),
    costUSD: z.number().optional().catch(undefined),
  })
  .optional()
  .catch(undefined)

/** The `modelUsage` record as the line carries it: per model, an entry or the debris of a bent one. */
type ModelUsageRecord = Record<string, z.infer<typeof modelUsageEntrySchema>> | undefined

/**
 * The per-model split as published: every entry the record still vouches for,
 * buckets renamed to the usage idiom, `costUSD` riding along when recorded. A
 * record that is absent publishes no split, an empty one publishes an empty
 * split — the recorded fact that the backend billed no model — and a bent
 * entry is dropped whole rather than published half-read.
 */
const modelsOf = (modelUsage: ModelUsageRecord): Record<string, ClaudeModelUsage> | undefined => {
  if (modelUsage === undefined) return undefined
  const models: Record<string, ClaudeModelUsage> = {}
  for (const [model, entry] of Object.entries(modelUsage)) {
    if (entry === undefined) continue
    models[model] = {
      input: entry.inputTokens,
      output: entry.outputTokens,
      cacheWrite: entry.cacheCreationInputTokens,
      cacheRead: entry.cacheReadInputTokens,
      ...(entry.costUSD === undefined ? {} : { costUsd: entry.costUSD }),
    }
  }
  return models
}

/** The per-bucket sums of a published split — the split's half of the maximum. */
const splitBucketsOf = (models: Record<string, ClaudeModelUsage>): Omit<ClaudeUsage, 'total'> => {
  const buckets = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
  for (const entry of Object.values(models)) {
    buckets.input += entry.input
    buckets.output += entry.output
    buckets.cacheWrite += entry.cacheWrite
    buckets.cacheRead += entry.cacheRead
  }
  return buckets
}

/** The line's complete usage account: the published buckets and the split behind them. */
export interface ClaudeUsageAccount {
  readonly usage: ClaudeUsage
  readonly models?: Readonly<Record<string, ClaudeModelUsage>>
}

/**
 * Reads the line's complete usage account out of the two places the CLI
 * reports it. `usage` is the per-bucket maximum of the top-level reading and
 * the split's sums: the CLI's top-level figure names only its main model, so
 * a split can only raise a bucket, never lower one — and a partial split must
 * never drag the published figure below the reading the CLI stated outright.
 * `total` is the four published buckets summed.
 */
export const usageAccountOf = (
  usage: z.infer<typeof usageSchema>,
  modelUsage: ModelUsageRecord,
): ClaudeUsageAccount => {
  const models = modelsOf(modelUsage)
  const split = splitBucketsOf(models ?? {})
  const buckets = {
    input: Math.max(usage.input_tokens, split.input),
    output: Math.max(usage.output_tokens, split.output),
    cacheWrite: Math.max(usage.cache_creation_input_tokens, split.cacheWrite),
    cacheRead: Math.max(usage.cache_read_input_tokens, split.cacheRead),
  }
  return {
    usage: {
      input: buckets.input,
      output: buckets.output,
      cacheWrite: buckets.cacheWrite,
      cacheRead: buckets.cacheRead,
      total: buckets.input + buckets.output + buckets.cacheWrite + buckets.cacheRead,
    },
    ...(models === undefined ? {} : { models }),
  }
}
