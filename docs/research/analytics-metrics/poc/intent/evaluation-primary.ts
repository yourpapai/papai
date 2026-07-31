// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IntentPrediction } from './classifiers.js'
import type { IntentCorpusRow } from './corpus-types.js'
import type { BasicMetrics, LabelMetrics, RiskCoveragePoint } from './evaluation-types.js'
import { INTENT_LABELS, type IntentLabel } from './taxonomy.js'

export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export function rounded(value: number): number {
  return Number(value.toFixed(6))
}

function metricsForLabel(
  label: IntentLabel,
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
): LabelMetrics {
  let support = 0
  let predicted = 0
  let truePositive = 0
  for (const [index, row] of rows.entries()) {
    const prediction = predictions[index]!
    if (row.gold_primary === label) support += 1
    if (prediction.primary === label) predicted += 1
    if (row.gold_primary === label && prediction.primary === label) truePositive += 1
  }
  const precision = ratio(truePositive, predicted)
  const recall = ratio(truePositive, support)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return {
    support,
    predicted,
    true_positive: truePositive,
    precision: rounded(precision),
    recall: rounded(recall),
    f1: rounded(f1),
  }
}

function labelMetrics(
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
): Readonly<Record<string, LabelMetrics>> {
  const metrics: Record<string, LabelMetrics> = {}
  for (const label of INTENT_LABELS) {
    metrics[label] = metricsForLabel(label, rows, predictions)
  }
  return metrics
}

export function basicMetrics(rows: readonly IntentCorpusRow[], predictions: readonly IntentPrediction[]): BasicMetrics {
  const accepted = predictions
    .map((prediction, index) => ({ prediction, index }))
    .filter(({ prediction }) => !prediction.abstained)
  const correct = predictions.filter((prediction, index) => prediction.primary === rows[index]!.gold_primary).length
  const selectiveCorrect = accepted.filter(
    ({ prediction, index }) => prediction.primary === rows[index]!.gold_primary,
  ).length
  const perLabel = labelMetrics(rows, predictions)
  const f1Sum = INTENT_LABELS.reduce((sum, label) => sum + perLabel[label]!.f1, 0)
  return {
    examples: rows.length,
    primary_accuracy: rounded(ratio(correct, rows.length)),
    primary_macro_f1: rounded(ratio(f1Sum, INTENT_LABELS.length)),
    coverage: rounded(ratio(accepted.length, rows.length)),
    selective_accuracy: rounded(ratio(selectiveCorrect, accepted.length)),
    per_label: perLabel,
  }
}

export function expectedCalibrationError(
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
): number {
  const ranked = predictions
    .map((prediction, index) => ({
      confidence: prediction.confidence,
      correct: prediction.primary === rows[index]!.gold_primary ? 1 : 0,
    }))
    .sort((left, right) => left.confidence - right.confidence)
  const binSize = Math.ceil(ranked.length / 10)
  let ece = 0
  for (let start = 0; start < ranked.length; start += binSize) {
    const bin = ranked.slice(start, start + binSize)
    const accuracy = ratio(
      bin.reduce((sum, item) => sum + item.correct, 0),
      bin.length,
    )
    const confidence = ratio(
      bin.reduce((sum, item) => sum + item.confidence, 0),
      bin.length,
    )
    ece += (bin.length / ranked.length) * Math.abs(accuracy - confidence)
  }
  return rounded(ece)
}

export function brierScore(rows: readonly IntentCorpusRow[], predictions: readonly IntentPrediction[]): number {
  const alternatives = INTENT_LABELS.length - 1
  let total = 0
  for (const [index, prediction] of predictions.entries()) {
    const remainder = (1 - prediction.confidence) / alternatives
    for (const label of INTENT_LABELS) {
      const probability = label === prediction.primary ? prediction.confidence : remainder
      const observed = rows[index]!.gold_primary === label ? 1 : 0
      total += (probability - observed) ** 2
    }
  }
  return rounded(ratio(total, rows.length))
}

function riskCoveragePoint(
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
  minimumConfidence: number,
): RiskCoveragePoint {
  const selected = predictions
    .map((prediction, index) => ({ prediction, index }))
    .filter(({ prediction }) => !prediction.abstained && prediction.confidence >= minimumConfidence)
  const accuracy = ratio(
    selected.filter(({ prediction, index }) => prediction.primary === rows[index]!.gold_primary).length,
    selected.length,
  )
  return {
    minimum_confidence: minimumConfidence,
    coverage: rounded(ratio(selected.length, rows.length)),
    selective_accuracy: rounded(accuracy),
    risk: rounded(1 - accuracy),
  }
}

export function riskCoverage(
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
): readonly RiskCoveragePoint[] {
  return [0.5, 0.7, 0.85, 0.9, 0.95, 0.97, 0.99].map((minimumConfidence) =>
    riskCoveragePoint(rows, predictions, minimumConfidence),
  )
}

export function sliceReport(
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
  selector: (row: IntentCorpusRow) => string,
): Readonly<Record<string, BasicMetrics>> {
  const report: Record<string, BasicMetrics> = {}
  const keys = [...new Set(rows.map(selector))].sort()
  for (const key of keys) {
    const selected = rows
      .map((row, index) => ({ row, prediction: predictions[index]! }))
      .filter(({ row }) => selector(row) === key)
    report[key] = basicMetrics(
      selected.map(({ row }) => row),
      selected.map(({ prediction }) => prediction),
    )
  }
  return report
}
