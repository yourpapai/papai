// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STRUCTURED_SIGNAL_BY_INTENT, TOOL_BY_INTENT } from './corpus-templates.js'
import type { IntentCorpusRow } from './corpus-types.js'
import { CORE_INTENTS, sortGoals, type CoreIntent, type IntentGoal, type IntentLabel } from './taxonomy.js'

export type DeterministicStrategy = 'tool_trace_v1' | 'metadata_v1' | 'hybrid_v1'

export interface IntentPrediction {
  readonly strategy: DeterministicStrategy
  readonly primary: IntentLabel
  readonly goals: readonly IntentGoal[]
  readonly confidence: number
  readonly abstained: boolean
  readonly tool_evidence_conflict: boolean
}

const TOOL_TO_INTENT = new Map<string, CoreIntent>(CORE_INTENTS.map((intent) => [TOOL_BY_INTENT[intent], intent]))

const SIGNAL_TO_INTENT = new Map<string, CoreIntent>(
  CORE_INTENTS.map((intent) => [STRUCTURED_SIGNAL_BY_INTENT[intent], intent]),
)

const META_TOOLS = new Set(['search_tools', 'load_tool', 'expand_result'])

function abstention(strategy: DeterministicStrategy, toolEvidenceConflict = false): IntentPrediction {
  return {
    strategy,
    primary: 'unknown',
    goals: [],
    confidence: 0.5,
    abstained: true,
    tool_evidence_conflict: toolEvidenceConflict,
  }
}

function predictionFromGoals(
  strategy: DeterministicStrategy,
  goals: readonly CoreIntent[],
  confidence: number,
): IntentPrediction {
  const ordered = sortGoals(goals)
  if (ordered.length === 0 || ordered.length > 3) return abstention(strategy)
  return {
    strategy,
    primary: ordered.length === 1 ? ordered[0]! : 'multi_goal',
    goals: ordered,
    confidence,
    abstained: false,
    tool_evidence_conflict: false,
  }
}

export function classifyToolTrace(row: IntentCorpusRow): IntentPrediction {
  const goals: CoreIntent[] = []
  let sawUnmappedGoalTool = false
  for (const tool of row.tool_trace) {
    if (META_TOOLS.has(tool.tool_slug)) continue
    const mapped = TOOL_TO_INTENT.get(tool.tool_slug)
    if (mapped === undefined) {
      sawUnmappedGoalTool = true
      continue
    }
    goals.push(mapped)
  }
  if (sawUnmappedGoalTool) return abstention('tool_trace_v1', goals.length > 0)
  return goals.length === 0 ? abstention('tool_trace_v1') : predictionFromGoals('tool_trace_v1', goals, 0.99)
}

function metadataGoals(row: IntentCorpusRow): CoreIntent[] {
  return row.feature_events.flatMap((event) => {
    const intent = SIGNAL_TO_INTENT.get(event)
    return intent === undefined ? [] : [intent]
  })
}

export function classifyMetadata(row: IntentCorpusRow): IntentPrediction {
  const goals = metadataGoals(row)
  if (goals.length > 0) return predictionFromGoals('metadata_v1', goals, 0.97)
  if (row.command_family === 'help') {
    return predictionFromGoals('metadata_v1', ['help_context'], 0.99)
  }
  if (row.command_family === 'config') {
    return predictionFromGoals('metadata_v1', ['configuration_permissions'], 0.99)
  }
  if (row.command_family === 'stop') {
    return {
      strategy: 'metadata_v1',
      primary: 'no_action',
      goals: ['no_action'],
      confidence: 0.99,
      abstained: false,
      tool_evidence_conflict: false,
    }
  }
  if (row.feature_events.includes('turn:unsupported_goal')) {
    return {
      strategy: 'metadata_v1',
      primary: 'unknown',
      goals: [],
      confidence: 0.95,
      abstained: false,
      tool_evidence_conflict: false,
    }
  }
  return abstention('metadata_v1')
}

export function classifyHybrid(row: IntentCorpusRow): IntentPrediction {
  const toolPrediction = classifyToolTrace(row)
  if (!toolPrediction.abstained) return { ...toolPrediction, strategy: 'hybrid_v1' }
  const metadataPrediction = classifyMetadata(row)
  return {
    ...metadataPrediction,
    strategy: 'hybrid_v1',
    tool_evidence_conflict: toolPrediction.tool_evidence_conflict || metadataPrediction.tool_evidence_conflict,
  }
}
