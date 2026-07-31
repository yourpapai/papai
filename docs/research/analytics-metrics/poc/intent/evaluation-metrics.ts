// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { classifyToolTrace, type IntentPrediction } from './classifiers.js'
import type { IntentCorpusRow } from './corpus-types.js'
import { goalMetrics } from './evaluation-goals.js'
import {
  basicMetrics,
  brierScore,
  expectedCalibrationError,
  ratio,
  riskCoverage,
  rounded,
  sliceReport,
} from './evaluation-primary.js'
import type {
  Classifier,
  CompleteMetrics,
  EvaluatedStrategy,
  ThresholdReport,
  ThresholdResult,
} from './evaluation-types.js'
import { CORE_INTENTS } from './taxonomy.js'

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
}

function measureLatency(
  rows: readonly IntentCorpusRow[],
  classify: Classifier,
  iterations: number,
): { readonly worker_p50_ms: number; readonly worker_p95_ms: number } {
  const samples: number[] = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const row of rows) {
      const start = performance.now()
      classify(row)
      samples.push(performance.now() - start)
    }
  }
  return {
    worker_p50_ms: Number(percentile(samples, 0.5).toFixed(6)),
    worker_p95_ms: Number(percentile(samples, 0.95).toFixed(6)),
  }
}

function acceptedToolRulePrecision(rows: readonly IntentCorpusRow[]): number {
  const accepted = rows
    .map((row) => ({ row, prediction: classifyToolTrace(row) }))
    .filter(({ prediction }) => !prediction.abstained)
  const correct = accepted.filter(({ row, prediction }) => prediction.primary === row.gold_primary).length
  return rounded(ratio(correct, accepted.length))
}

function conflictRate(rows: readonly IntentCorpusRow[], predictions: readonly IntentPrediction[]): number {
  const conflicts = predictions.filter(({ tool_evidence_conflict }) => tool_evidence_conflict).length
  return rounded(ratio(conflicts, rows.length))
}

export function completeMetrics(
  rows: readonly IntentCorpusRow[],
  predictions: readonly IntentPrediction[],
  classify: Classifier,
  latencyIterations: number,
): CompleteMetrics {
  const basics = basicMetrics(rows, predictions)
  const goals = goalMetrics(rows, predictions)
  const latency = measureLatency(rows, classify, latencyIterations)
  return {
    ...basics,
    multi_goal_exact_set_accuracy: goals.exact_set_accuracy,
    multi_goal_micro_f1: goals.micro_f1,
    multi_goal_macro_f1: goals.macro_f1,
    multi_goal_examples: goals.examples,
    no_action_precision: basics.per_label['no_action']!.precision,
    unknown_precision: basics.per_label['unknown']!.precision,
    expected_calibration_error_10_equal_frequency_bins: expectedCalibrationError(rows, predictions),
    brier_score: brierScore(rows, predictions),
    risk_coverage: riskCoverage(rows, predictions),
    accepted_rule_precision: acceptedToolRulePrecision(rows),
    tool_evidence_conflict_rate: conflictRate(rows, predictions),
    text_egress_share: 0,
    small_model_calls_per_1000_turns: 0,
    small_model_input_tokens: null,
    small_model_output_tokens: null,
    small_model_cost_usd_per_1000_turns: null,
    small_model_cost_percent_of_main_model_spend: null,
    classifier_worker_p50_ms: latency.worker_p50_ms,
    classifier_worker_p95_ms: latency.worker_p95_ms,
    label_ready_p95_ms: latency.worker_p95_ms,
    user_visible_added_latency_ms: 0,
    persisted_classifier_input_output_content_count: 0,
  }
}

function threshold(actual: number, requirement: string, passed: boolean): ThresholdResult {
  return { actual, requirement, passed }
}

function qualityThresholds(
  metrics: CompleteMetrics,
): Omit<
  ThresholdReport,
  | 'tool_trace_accepted_rule_precision'
  | 'user_visible_added_latency_ms'
  | 'label_ready_p95_ms'
  | 'persisted_classifier_content'
  | 'all_passed'
> {
  const coreFloor = Math.min(...CORE_INTENTS.map((label) => metrics.per_label[label]!.f1))
  return {
    primary_macro_f1: threshold(metrics.primary_macro_f1, '>= 0.85', metrics.primary_macro_f1 >= 0.85),
    core_label_floor: threshold(coreFloor, 'I01-I20 each >= 0.75', coreFloor >= 0.75),
    no_action_precision: threshold(metrics.no_action_precision, '>= 0.90', metrics.no_action_precision >= 0.9),
    unknown_precision: threshold(metrics.unknown_precision, '>= 0.90', metrics.unknown_precision >= 0.9),
    multi_goal_micro_f1: threshold(metrics.multi_goal_micro_f1, '>= 0.80', metrics.multi_goal_micro_f1 >= 0.8),
    multi_goal_exact_set_accuracy: threshold(
      metrics.multi_goal_exact_set_accuracy,
      '>= 0.70',
      metrics.multi_goal_exact_set_accuracy >= 0.7,
    ),
    selective_accuracy_at_coverage: threshold(
      metrics.selective_accuracy,
      'accuracy >= 0.90 at coverage >= 0.80',
      metrics.selective_accuracy >= 0.9 && metrics.coverage >= 0.8,
    ),
    expected_calibration_error: threshold(
      metrics.expected_calibration_error_10_equal_frequency_bins,
      '<= 0.05',
      metrics.expected_calibration_error_10_equal_frequency_bins <= 0.05,
    ),
  }
}

function operationalThresholds(
  metrics: CompleteMetrics,
): Pick<
  ThresholdReport,
  | 'tool_trace_accepted_rule_precision'
  | 'user_visible_added_latency_ms'
  | 'label_ready_p95_ms'
  | 'persisted_classifier_content'
> {
  return {
    tool_trace_accepted_rule_precision: threshold(
      metrics.accepted_rule_precision,
      '>= 0.97',
      metrics.accepted_rule_precision >= 0.97,
    ),
    user_visible_added_latency_ms: threshold(
      metrics.user_visible_added_latency_ms,
      '= 0',
      metrics.user_visible_added_latency_ms === 0,
    ),
    label_ready_p95_ms: threshold(metrics.label_ready_p95_ms, '<= 5000', metrics.label_ready_p95_ms <= 5_000),
    persisted_classifier_content: threshold(
      metrics.persisted_classifier_input_output_content_count,
      '= 0',
      metrics.persisted_classifier_input_output_content_count === 0,
    ),
  }
}

export function thresholdReport(metrics: CompleteMetrics): ThresholdReport {
  const quality = qualityThresholds(metrics)
  const operational = operationalThresholds(metrics)
  const allPassed = [...Object.values(quality), ...Object.values(operational)].every(({ passed }) => passed)
  return { ...quality, ...operational, all_passed: allPassed }
}

export function evaluatedStrategy(
  rows: readonly IntentCorpusRow[],
  classify: Classifier,
  latencyIterations: number,
): EvaluatedStrategy {
  const predictions = rows.map(classify)
  const metrics = completeMetrics(rows, predictions, classify, latencyIterations)
  const thresholds = thresholdReport(metrics)
  return {
    execution_status: 'EXECUTED',
    qualification_status: thresholds.all_passed ? 'QUALIFIED_ON_SYNTHETIC_TEST' : 'NOT_QUALIFIED',
    metrics,
    thresholds,
    slices: {
      language: sliceReport(rows, predictions, (row) => row.language),
      context_type: sliceReport(rows, predictions, (row) => row.context_type),
    },
  }
}
