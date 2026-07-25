#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Operator script: prints the memory-recall shadow-logging under-trigger funnel
 * (see `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`).
 *
 * Reads `memory_recall_shadow_log` (populated only when the shadow-logging kill switch
 * is enabled) and prints one row of aggregates per `reader_model_id` -- never a pooled
 * cross-model average.
 *
 * Anonymity: this script prints only aggregate counts/rates per reader model. It never
 * prints per-row hashes, query text, or any other free-form/high-cardinality value that
 * could aid re-identification by correlation.
 *
 * Usage:
 *   bun run scripts/memory-shadow-funnel.ts [--reader-model-id <id>]
 */

import { computeShadowFunnel } from '../src/long-term-memory/shadow-funnel.js'

function parseReaderModelId(argv: readonly string[]): string | undefined {
  const flagIndex = argv.indexOf('--reader-model-id')
  if (flagIndex === -1) return undefined
  return argv[flagIndex + 1]
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function printFunnel(): void {
  const readerModelId = parseReaderModelId(process.argv.slice(2))
  const entries = computeShadowFunnel(readerModelId === undefined ? {} : { readerModelId })

  if (entries.length === 0) {
    console.log('No shadow-log rows found (shadow logging may be disabled, or no turns sampled yet).')
    return
  }

  console.log('Memory-recall shadow under-trigger funnel (per reader model -- never averaged across models)\n')

  for (const entry of entries) {
    console.log(`reader_model_id: ${entry.readerModelId}`)
    console.log(`  memory-bearing turns:      ${entry.memoryBearingTurns}`)
    console.log(`  shadow_hit turns (rank>=1): ${entry.shadowHitTurns}`)
    console.log(`  under-trigger turns:       ${entry.underTriggerTurns}`)
    console.log(`  under-trigger rate:        ${formatRate(entry.underTriggerRate)}`)
    console.log(`  overlap-when-pulled turns: ${entry.overlapWhenPulled}`)
    console.log(`  over-pull turns:           ${entry.overPullTurns}`)
    console.log(`  distinct scopes (M):       ${entry.distinctScopes}`)
    console.log('')
  }

  console.log(
    'Note: shadow_hit is a rank cutoff (top-k position within the shadow cascade), not a relevance-score' +
      ' threshold -- see the doc comment on ShadowRecallHit.score in src/long-term-memory/shadow-recall.ts.',
  )
  console.log(
    'Note: over-pull turns (shadow_pull_overlap = 0) is NOT a pre-registered or spec-numeric threshold -- the' +
      ' design doc only describes this companion signal qualitatively ("low overlap"). It is this repo\'s own' +
      ' operationalization and sits outside the frozen go/no-go gate.',
  )
  console.log(
    'Note: distinct scopes (M) IS part of the frozen go/no-go gate -- the gate requires N = 1000 sampled' +
      ' memory-bearing turns across M >= 50 distinct scopes, per reader model, before trusting the' +
      ' under-trigger rate above. Compare this count against 50 before acting on that rate.',
  )
}

printFunnel()
