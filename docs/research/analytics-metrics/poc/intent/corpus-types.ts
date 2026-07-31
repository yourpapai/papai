// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CoreIntent, IntentGoal, IntentLabel } from './taxonomy.js'

export type CorpusLanguage = 'en' | 'mixed' | 'ru'
export type CorpusSplit = 'development' | 'calibration' | 'test'
export type CorpusCohort = 'canonical_core' | 'no_action' | 'unknown' | 'multi_goal' | 'adversarial_boundary'

export type CommandFamily = 'config' | 'help' | 'none' | 'stop'
export type ToolOutcome = 'semantic_success' | 'structured_failure' | 'thrown_failure' | 'permission_denied'

export interface CorpusToolTrace {
  readonly ordinal: number
  readonly tool_slug: string
  readonly outcome: ToolOutcome
}

export interface IntentCorpusRow {
  readonly example_id: string
  readonly scenario_family_id: string
  readonly split: CorpusSplit
  readonly cohort: CorpusCohort
  readonly language: CorpusLanguage
  readonly context_type: 'dm' | 'group'
  readonly actor_role: 'admin' | 'member'
  readonly task_provider: 'kaneo' | 'none' | 'youtrack'
  readonly message: string
  readonly tool_trace: readonly CorpusToolTrace[]
  readonly finish_reason: 'error' | 'stop' | 'tool_calls'
  readonly step_count: number
  readonly clarification: boolean
  readonly error_class: 'none' | 'unsupported'
  readonly command_family: CommandFamily
  readonly feature_events: readonly string[]
  readonly gold_primary: IntentLabel
  readonly gold_goals: readonly IntentGoal[]
  readonly adjudication_notes: string
}

export interface FamilySpec {
  readonly familyId: string
  readonly split: CorpusSplit
  readonly cohort: CorpusCohort
  readonly language: CorpusLanguage
  readonly primary: IntentLabel
  readonly goals: readonly IntentGoal[]
  readonly nearNeighbor?: CoreIntent
  readonly familyOrdinal: number
}

export interface CorpusManifest {
  readonly schema: 'papai.intent.corpus-manifest.v1'
  readonly spdx: 'BUSL-1.1'
  readonly taxonomy: 'intent.v1'
  readonly corpus: {
    readonly path: 'intent-v1-corpus.jsonl'
    readonly examples: 3000
    readonly scenario_families: 300
    readonly sha256: string
    readonly splits: Readonly<Record<CorpusSplit, number>>
    readonly languages: Readonly<Record<CorpusLanguage, number>>
    readonly cohorts: Readonly<Record<CorpusCohort, number>>
    readonly invented_content_only: true
  }
  readonly reproducibility: {
    readonly ordered_jsonl: true
    readonly examples_per_family: 10
    readonly split_unit: 'scenario_family_id'
    readonly family_manifest_sha256: string
    readonly taxonomy_sha256: string
    readonly generator_sha256: string
    readonly family_generator_sha256: string
    readonly templates_sha256: string
    readonly evaluator_sha256: string
    readonly classifier_sha256: string
    readonly small_model_contract_sha256: string
    readonly small_model_prompt_sha256: string
    readonly small_model_request_schema_sha256: string
    readonly small_model_result_schema_sha256: string
  }
  readonly family_splits: readonly {
    readonly scenario_family_id: string
    readonly split: CorpusSplit
    readonly examples: 10
  }[]
  readonly annotation: {
    readonly prototype_source: 'versioned_hand_authored_templates'
    readonly independent_human_review: 'NOT_EXECUTED'
    readonly cohen_kappa_primary: null
    readonly jaccard_goals: null
    readonly qualification_effect: 'requires_independent_review_before_production_claims'
  }
}
