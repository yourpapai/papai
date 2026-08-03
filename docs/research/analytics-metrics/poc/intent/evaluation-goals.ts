// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IntentPrediction } from './classifiers.js'
import type { IntentCorpusRow } from './corpus-types.js'
import { ratio, rounded } from './evaluation-primary.js'
import type { GoalMetrics } from './evaluation-types.js'
import { CORE_INTENTS, type CoreIntent } from './taxonomy.js'

interface PerGoalCounts {
  readonly goal: CoreIntent
  tp: number
  fp: number
  fn: number
}

interface GoalAccumulator {
  exact: number
  tp: number
  fp: number
  fn: number
  readonly perGoal: PerGoalCounts[]
}

function newAccumulator(): GoalAccumulator {
  return {
    exact: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    perGoal: CORE_INTENTS.map((goal) => ({ goal, tp: 0, fp: 0, fn: 0 })),
  }
}

function accumulate(accumulator: GoalAccumulator, row: IntentCorpusRow, prediction: IntentPrediction): void {
  const expected = new Set(row.gold_goals)
  const actual = new Set(prediction.goals)
  if (expected.size === actual.size && [...expected].every((goal) => actual.has(goal))) {
    accumulator.exact += 1
  }
  for (const metrics of accumulator.perGoal) {
    const inExpected = expected.has(metrics.goal)
    const inActual = actual.has(metrics.goal)
    if (inExpected && inActual) {
      metrics.tp += 1
      accumulator.tp += 1
    } else if (!inExpected && inActual) {
      metrics.fp += 1
      accumulator.fp += 1
    } else if (inExpected && !inActual) {
      metrics.fn += 1
      accumulator.fn += 1
    }
  }
}

function f1(truePositive: number, falsePositive: number, falseNegative: number): number {
  const precision = ratio(truePositive, truePositive + falsePositive)
  const recall = ratio(truePositive, truePositive + falseNegative)
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
}

export function goalMetrics(rows: readonly IntentCorpusRow[], predictions: readonly IntentPrediction[]): GoalMetrics {
  const indexes = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.gold_primary === 'multi_goal')
  const accumulator = newAccumulator()
  for (const { row, index } of indexes) {
    accumulate(accumulator, row, predictions[index]!)
  }
  const supported = accumulator.perGoal.filter(({ tp, fn }) => tp + fn > 0)
  const macroF1 = ratio(
    supported.reduce((sum, counts) => sum + f1(counts.tp, counts.fp, counts.fn), 0),
    supported.length,
  )
  return {
    exact_set_accuracy: rounded(ratio(accumulator.exact, indexes.length)),
    micro_f1: rounded(f1(accumulator.tp, accumulator.fp, accumulator.fn)),
    macro_f1: rounded(macroF1),
    examples: indexes.length,
  }
}
