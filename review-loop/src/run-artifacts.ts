// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { ReviewLoopResult } from './loop-controller.js'
import { PersistedStatsSchema, type PersistedStats, type RunStats } from './run-stats.js'
import { buildMetricsJson, buildSummary } from './summary.js'

/**
 * What a run leaves behind on disk, and what a resumed run reads back.
 *
 * Written **before** the run finalizes, deliberately, and that ordering is the
 * reason this exists as its own step rather than as the tail of a successful
 * run: the final build gate and the merge are the two things most likely to
 * throw, and a run whose summary and metrics died with them is a run nobody can
 * say anything about afterwards.
 */

const MetricsEnvelopeSchema = z.object({ runStats: PersistedStatsSchema.optional() })

export async function readPersistedRunStats(runDir: string): Promise<PersistedStats | undefined> {
  try {
    const parsed = MetricsEnvelopeSchema.safeParse(
      JSON.parse(await readFile(path.join(runDir, 'metrics.json'), 'utf8')),
    )
    return parsed.success ? parsed.data.runStats : undefined
  } catch {
    return undefined
  }
}

export async function writeRunArtifacts(
  runDir: string,
  result: ReviewLoopResult,
  options: { poolSize: number; inspect: boolean; wallMs: number; stats?: RunStats },
): Promise<void> {
  const closed = Object.values(result.ledger.issues).filter((r) => r.status === 'closed').length
  const summary = buildSummary({
    doneReason: result.doneReason,
    rounds: result.rounds,
    metrics: result.metrics ?? [],
    ledger: result.ledger,
    runDir,
    wallMs: options.wallMs,
    options: { poolSize: options.poolSize, inspect: options.inspect },
    stats: options.stats?.snapshot(),
  })
  await writeFile(path.join(runDir, 'summary.txt'), `${summary}\n`)
  try {
    await writeFile(
      path.join(runDir, 'metrics.json'),
      `${JSON.stringify(
        buildMetricsJson(
          result.doneReason,
          result.rounds,
          closed,
          result.metrics ?? [],
          options,
          options.stats?.persist(),
        ),
        null,
        2,
      )}\n`,
    )
  } catch (error) {
    console.warn(`[review-loop] metrics.json write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(summary)
}
