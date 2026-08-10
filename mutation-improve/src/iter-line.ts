// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ARROW, CHECK, formatDuration, MIDDLE_DOT, truncate } from '../../review-loop/src/live-format.js'
import type { IterationResult } from './pipeline.js'

/**
 * All phases of one iteration (select agent → improve agent → build/mutate
 * gates → build-fix retries) render into this single slot: iterations are
 * strictly sequential with at most one agent running, so one constant key
 * suffices. runPipeline commits it once per iteration via formatIterLine.
 */
export const ITER_SLOT_KEY = 'iter'

const CROSS = '✗'
const DASH = '–'
const GEQ = '≥'
const REASON_MAX = 160

export interface IterSlotLog {
  dynamic?: boolean
  slot?: (key: string, line: string | null) => void
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

export function formatIterLine(outcome: IterationResult, elapsedMs: number): string {
  const head = `iter ${outcome.iter}`
  const filePart = outcome.file === undefined ? [] : [outcome.file]
  const duration = formatDuration(elapsedMs)
  if (outcome.outcome === 'improved' || outcome.outcome === 'capped') {
    const scores =
      outcome.beforeScore === undefined || outcome.afterScore === undefined
        ? []
        : [`${pct(outcome.beforeScore)}→${pct(outcome.afterScore)}`]
    return [`${head} ${CHECK} ${outcome.outcome}`, ...filePart, ...scores, duration].join(` ${MIDDLE_DOT} `)
  }
  if (outcome.outcome === 'skipped') {
    const score = outcome.beforeScore === undefined ? [] : [`${pct(outcome.beforeScore)} ${GEQ} threshold`]
    return [`${head} ${DASH} skipped`, ...filePart, ...score, duration].join(` ${MIDDLE_DOT} `)
  }
  const gate = outcome.gate ?? 'error'
  const detail = outcome.reason === undefined ? gate : `${gate}: ${truncate(outcome.reason, REASON_MAX)}`
  return [`${head} ${CROSS} failed`, ...filePart, detail, duration].join(` ${MIDDLE_DOT} `)
}

/**
 * Renders a non-agent phase (build gate, mutation run) into the iteration's
 * slot with a 1s ticker, replacing withLivePhase for mutation-improve: that
 * helper emits a permanent start event and clears the slot at the end, both
 * wrong for the one-line-per-iteration model. The slot is left live on
 * completion; the pipeline's commit (or the next phase's tick) replaces it.
 */
export async function withIterPhase<T>(log: IterSlotLog, label: string, fn: () => Promise<T>): Promise<T> {
  if (log.slot === undefined || log.dynamic !== true) return fn()
  const slot = log.slot
  const start = Date.now()
  const tick = (): void => {
    slot(ITER_SLOT_KEY, `  ${label.padEnd(10)} ${ARROW} ${formatDuration(Date.now() - start)}`)
  }
  tick()
  const timer = setInterval(tick, 1000)
  try {
    return await fn()
  } finally {
    clearInterval(timer)
  }
}
