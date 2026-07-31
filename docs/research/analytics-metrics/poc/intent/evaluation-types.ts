// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IntentPrediction } from './classifiers.js'
import type { CorpusLanguage, IntentCorpusRow } from './corpus-types.js'

export type Classifier = (row: IntentCorpusRow) => IntentPrediction

export interface LabelMetrics {
  readonly support: number
  readonly predicted: number
  readonly true_positive: number
  readonly precision: number
  readonly recall: number
  readonly f1: number
}

export interface BasicMetrics {
  readonly examples: number
  readonly primary_accuracy: number
  readonly primary_macro_f1: number
  readonly coverage: number
  readonly selective_accuracy: number
  readonly per_label: Readonly<Record<string, LabelMetrics>>
}

export interface GoalMetrics {
  readonly exact_set_accuracy: number
  readonly micro_f1: number
  readonly macro_f1: number
  readonly examples: number
}

export interface RiskCoveragePoint {
  readonly minimum_confidence: number
  readonly coverage: number
  readonly selective_accuracy: number
  readonly risk: number
}

export interface CompleteMetrics extends BasicMetrics {
  readonly multi_goal_exact_set_accuracy: number
  readonly multi_goal_micro_f1: number
  readonly multi_goal_macro_f1: number
  readonly multi_goal_examples: number
  readonly no_action_precision: number
  readonly unknown_precision: number
  readonly expected_calibration_error_10_equal_frequency_bins: number
  readonly brier_score: number
  readonly risk_coverage: readonly RiskCoveragePoint[]
  readonly accepted_rule_precision: number
  readonly tool_evidence_conflict_rate: number
  readonly text_egress_share: 0
  readonly small_model_calls_per_1000_turns: 0
  readonly small_model_input_tokens: null
  readonly small_model_output_tokens: null
  readonly small_model_cost_usd_per_1000_turns: null
  readonly small_model_cost_percent_of_main_model_spend: null
  readonly classifier_worker_p50_ms: number
  readonly classifier_worker_p95_ms: number
  readonly label_ready_p95_ms: number
  readonly user_visible_added_latency_ms: 0
  readonly persisted_classifier_input_output_content_count: 0
}

export interface ThresholdResult {
  readonly actual: number
  readonly requirement: string
  readonly passed: boolean
}

export interface ThresholdReport {
  readonly primary_macro_f1: ThresholdResult
  readonly core_label_floor: ThresholdResult
  readonly no_action_precision: ThresholdResult
  readonly unknown_precision: ThresholdResult
  readonly multi_goal_micro_f1: ThresholdResult
  readonly multi_goal_exact_set_accuracy: ThresholdResult
  readonly selective_accuracy_at_coverage: ThresholdResult
  readonly expected_calibration_error: ThresholdResult
  readonly tool_trace_accepted_rule_precision: ThresholdResult
  readonly user_visible_added_latency_ms: ThresholdResult
  readonly label_ready_p95_ms: ThresholdResult
  readonly persisted_classifier_content: ThresholdResult
  readonly all_passed: boolean
}

export interface EvaluatedStrategy {
  readonly execution_status: 'EXECUTED'
  readonly qualification_status: 'QUALIFIED_ON_SYNTHETIC_TEST' | 'NOT_QUALIFIED'
  readonly metrics: CompleteMetrics
  readonly thresholds: ThresholdReport
  readonly slices: {
    readonly language: Readonly<Record<string, BasicMetrics>>
    readonly context_type: Readonly<Record<string, BasicMetrics>>
  }
}

export interface SmallModelEvidence {
  readonly execution_status: 'NOT_EXECUTED'
  readonly qualification_status: 'NOT_QUALIFIED'
  readonly reason_codes: readonly string[]
  readonly calls: 0
  readonly measurements: {
    readonly tokens: null
    readonly cost_usd_per_1000_turns: null
    readonly worker_p50_ms: null
    readonly worker_p95_ms: null
    readonly label_ready_p95_ms: null
    readonly user_visible_added_latency_ms: 0
    readonly persisted_classifier_input_output_content_count: 0
  }
}

export interface EvaluationReport {
  readonly schema: 'papai.intent.evaluation.v1'
  readonly spdx: 'BUSL-1.1'
  readonly taxonomy: 'intent.v1'
  readonly corpus: {
    readonly examples: number
    readonly synthetic_only: true
    readonly production_messages: 0
  }
  readonly sealed_test: {
    readonly examples: number
    readonly scenario_families: number
    readonly languages: Record<CorpusLanguage, number>
    readonly reuse_policy: string
  }
  readonly strategies: {
    readonly tool_trace_v1: EvaluatedStrategy
    readonly metadata_v1: EvaluatedStrategy
    readonly hybrid_v1: EvaluatedStrategy
    readonly small_model_v1: SmallModelEvidence
  }
  readonly recommendation: {
    readonly selected: 'hybrid_v1_without_small_model' | 'none'
    readonly decision: 'ADVANCE_DETERMINISTIC_A_PLUS_B' | 'DO_NOT_SHIP_CLASSIFIER'
    readonly scope: 'synthetic_research_candidate_only'
    readonly small_model: 'KEEP_OFF'
    readonly production_qualification: 'PENDING_INDEPENDENT_HUMAN_ADJUDICATION_AND_OPT_IN_VALIDATION'
    readonly rationale: string
  }
}
