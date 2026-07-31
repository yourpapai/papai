// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  NEAR_NEIGHBOR,
  renderAdversarialMessage,
  renderCoreMessage,
  renderMultiGoalMessage,
  renderNoActionMessage,
  renderUnknownMessage,
  STRUCTURED_SIGNAL_BY_INTENT,
  TOOL_BY_INTENT,
} from './corpus-templates.js'
import type { CorpusLanguage, CorpusSplit, FamilySpec, IntentCorpusRow } from './corpus-types.js'
import { CORE_INTENTS, sortGoals, type IntentGoal } from './taxonomy.js'

const EXAMPLES_PER_FAMILY = 10

function canonicalSplit(index: number): CorpusSplit {
  if (index < 6) return 'development'
  if (index < 8) return 'calibration'
  return 'test'
}

function groupedSplit(index: number, developmentCount: number, calibrationCount: number): CorpusSplit {
  if (index < developmentCount) return 'development'
  if (index < developmentCount + calibrationCount) return 'calibration'
  return 'test'
}

function canonicalLanguage(index: number): CorpusLanguage {
  return index % 2 === 0 ? 'en' : 'ru'
}

function singleLabelLanguage(index: number, primary: 'no_action' | 'unknown'): CorpusLanguage {
  if (index < 6) return 'en'
  if (index < 12) return 'ru'
  if (index < 15) return 'mixed'
  if (index < 20) {
    const englishBoundary = primary === 'no_action' ? 17 : 18
    return index < englishBoundary ? 'en' : 'ru'
  }
  const englishBoundary = primary === 'no_action' ? 23 : 22
  return index < englishBoundary ? 'en' : 'ru'
}

function multiGoalLanguage(index: number): CorpusLanguage {
  if (index < 8) return 'en'
  if (index < 16) return 'ru'
  if (index < 18) return 'mixed'
  if (index < 21) return 'en'
  if (index < 23) return 'ru'
  if (index === 23) return 'mixed'
  if (index < 26) return 'en'
  if (index < 29) return 'ru'
  return 'mixed'
}

function coreFamilies(): FamilySpec[] {
  return CORE_INTENTS.flatMap((primary, labelIndex) => {
    const canonical = Array.from(
      { length: 10 },
      (_, familyIndex): FamilySpec => ({
        familyId: `core_${String(labelIndex + 1).padStart(2, '0')}_${String(familyIndex + 1).padStart(2, '0')}`,
        split: canonicalSplit(familyIndex),
        cohort: 'canonical_core',
        language: canonicalLanguage(familyIndex),
        primary,
        goals: [primary],
        familyOrdinal: labelIndex * 10 + familyIndex,
      }),
    )
    const adversarial: FamilySpec = {
      familyId: `boundary_${String(labelIndex + 1).padStart(2, '0')}`,
      split: groupedSplit(labelIndex, 12, 4),
      cohort: 'adversarial_boundary',
      language: 'mixed',
      primary,
      goals: [primary],
      nearNeighbor: NEAR_NEIGHBOR[primary],
      familyOrdinal: 200 + labelIndex,
    }
    return [...canonical, adversarial]
  })
}

function singleLabelFamilies(
  cohort: 'no_action' | 'unknown',
  primary: 'no_action' | 'unknown',
  startOrdinal: number,
): FamilySpec[] {
  const goals: readonly IntentGoal[] = primary === 'no_action' ? ['no_action'] : []
  return Array.from(
    { length: 25 },
    (_, index): FamilySpec => ({
      familyId: `${cohort}_${String(index + 1).padStart(2, '0')}`,
      split: groupedSplit(index, 15, 5),
      cohort,
      language: singleLabelLanguage(index, primary),
      primary,
      goals,
      familyOrdinal: startOrdinal + index,
    }),
  )
}

function multiGoalFamilies(): FamilySpec[] {
  return Array.from({ length: 30 }, (_, index): FamilySpec => {
    const first = CORE_INTENTS[index % CORE_INTENTS.length]!
    const second = CORE_INTENTS[(index * 7 + 3) % CORE_INTENTS.length]!
    const third = index % 5 === 0 ? CORE_INTENTS[(index * 11 + 8) % CORE_INTENTS.length]! : undefined
    const goals = sortGoals(third === undefined ? [first, second] : [first, second, third])
    const distinctGoals = goals.length < 2 ? sortGoals([first, CORE_INTENTS[(index + 1) % 20]!]) : goals
    return {
      familyId: `multi_goal_${String(index + 1).padStart(2, '0')}`,
      split: groupedSplit(index, 18, 6),
      cohort: 'multi_goal',
      language: multiGoalLanguage(index),
      primary: 'multi_goal',
      goals: distinctGoals,
      familyOrdinal: 270 + index,
    }
  })
}

export function buildFamilySpecs(): FamilySpec[] {
  const specs = [
    ...coreFamilies(),
    ...singleLabelFamilies('no_action', 'no_action', 220),
    ...singleLabelFamilies('unknown', 'unknown', 245),
    ...multiGoalFamilies(),
  ].sort((left, right) => left.familyOrdinal - right.familyOrdinal)
  if (specs.length !== 300) throw new Error(`Expected 300 scenario families, got ${specs.length}`)
  return specs
}

function toolTraceFor(spec: FamilySpec, variant: number): IntentCorpusRow['tool_trace'] {
  if (spec.cohort === 'canonical_core') {
    const goal = spec.goals[0]
    if (goal === undefined || goal === 'no_action') throw new Error(`Invalid core family ${spec.familyId}`)
    return [
      {
        ordinal: 1,
        tool_slug: TOOL_BY_INTENT[goal],
        outcome: variant % 7 === 0 ? 'structured_failure' : 'semantic_success',
      },
    ]
  }
  if (spec.cohort === 'adversarial_boundary') {
    return [
      { ordinal: 1, tool_slug: 'search_tools', outcome: 'semantic_success' },
      { ordinal: 2, tool_slug: 'ambiguous_dynamic_tool', outcome: 'semantic_success' },
    ]
  }
  if (spec.cohort === 'multi_goal') {
    return spec.goals.map((goal, index) => {
      if (goal === 'no_action') throw new Error(`Invalid multi-goal family ${spec.familyId}`)
      return {
        ordinal: index + 1,
        tool_slug: TOOL_BY_INTENT[goal],
        outcome: index === 1 && variant % 9 === 0 ? 'permission_denied' : 'semantic_success',
      }
    })
  }
  if (spec.cohort === 'unknown') {
    return [{ ordinal: 1, tool_slug: 'search_tools', outcome: 'semantic_success' }]
  }
  return []
}

function messageFor(spec: FamilySpec, variant: number): string {
  if (spec.cohort === 'no_action') return renderNoActionMessage(spec.language, variant)
  if (spec.cohort === 'unknown') return renderUnknownMessage(spec.language, variant)
  if (spec.cohort === 'multi_goal') return renderMultiGoalMessage(spec, variant)
  if (spec.cohort === 'adversarial_boundary') return renderAdversarialMessage(spec, variant)
  const primary = spec.goals[0]
  if (primary === undefined || primary === 'no_action') throw new Error(`Invalid core family ${spec.familyId}`)
  return renderCoreMessage(primary, spec.language, variant)
}

function featureEventsFor(spec: FamilySpec): readonly string[] {
  if (spec.cohort === 'unknown') return ['turn:unsupported_goal']
  if (spec.cohort !== 'adversarial_boundary') return []
  const goal = spec.goals[0]
  if (goal === undefined || goal === 'no_action') throw new Error(`Invalid boundary family ${spec.familyId}`)
  return [STRUCTURED_SIGNAL_BY_INTENT[goal]]
}

function commandFamilyFor(spec: FamilySpec, variant: number): IntentCorpusRow['command_family'] {
  if (spec.cohort === 'no_action' && variant > 0) return 'stop'
  if (spec.cohort === 'canonical_core' && spec.primary === 'help_context') return 'help'
  if (spec.cohort === 'canonical_core' && spec.primary === 'configuration_permissions') return 'config'
  return 'none'
}

function rowFor(spec: FamilySpec, variant: number, exampleOrdinal: number): IntentCorpusRow {
  const toolTrace = toolTraceFor(spec, variant)
  const unknown = spec.cohort === 'unknown'
  return {
    example_id: `intent_v1_${String(exampleOrdinal).padStart(4, '0')}`,
    scenario_family_id: spec.familyId,
    split: spec.split,
    cohort: spec.cohort,
    language: spec.language,
    context_type: (spec.familyOrdinal + variant) % 3 === 0 ? 'group' : 'dm',
    actor_role: (spec.familyOrdinal + variant) % 5 === 0 ? 'admin' : 'member',
    task_provider: spec.goals.some((goal) => goal.startsWith('task.'))
      ? (spec.familyOrdinal + variant) % 2 === 0
        ? 'kaneo'
        : 'youtrack'
      : 'none',
    message: messageFor(spec, variant),
    tool_trace: toolTrace,
    finish_reason: unknown ? 'error' : toolTrace.length > 0 ? 'tool_calls' : 'stop',
    step_count: Math.max(1, toolTrace.length + ((spec.familyOrdinal + variant) % 3)),
    clarification: unknown,
    error_class: unknown ? 'unsupported' : 'none',
    command_family: commandFamilyFor(spec, variant),
    feature_events: featureEventsFor(spec),
    gold_primary: spec.primary,
    gold_goals: spec.goals,
    adjudication_notes: `Synthetic family prototype ${spec.familyId}; taxonomy ${spec.primary}; no production content.`,
  }
}

export function buildRows(): IntentCorpusRow[] {
  const rows = buildFamilySpecs().flatMap((spec, familyIndex) =>
    Array.from({ length: EXAMPLES_PER_FAMILY }, (_, variant) =>
      rowFor(spec, variant, familyIndex * EXAMPLES_PER_FAMILY + variant + 1),
    ),
  )
  if (rows.length !== 3_000) throw new Error(`Expected 3,000 examples, got ${rows.length}`)
  return rows
}
