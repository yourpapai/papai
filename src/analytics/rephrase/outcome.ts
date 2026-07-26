// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { classifyHybrid, toClassifierToolSlug } from '../intent/classifier.js'
import type { IntentClassifierInput, IntentPrediction } from '../intent/classifier.js'
import type { RephraseTurnOutcome } from '../intent/rephrase.js'
import type { RephraseTerminalEvidence } from '../turn-context.js'

export type RephraseOutcomeClassifier = (input: IntentClassifierInput) => IntentPrediction

const CLARIFICATION_ERROR_CLASSES: ReadonlySet<string> = new Set([
  'validation',
  'not_found',
  'permission',
  'authorization',
  'configuration',
])

type ToolEvidence = Extract<RephraseTerminalEvidence, { kind: 'tool_completed' }>

const isClarification = (tools: readonly ToolEvidence[]): boolean =>
  tools.some(
    (entry) =>
      entry.executionOutcome === 'structured_failure' &&
      entry.errorClass !== null &&
      CLARIFICATION_ERROR_CLASSES.has(entry.errorClass),
  )

const isUnrecoveredFailure = (tools: readonly ToolEvidence[]): boolean => {
  const hasSemanticSuccess = tools.some((entry) => entry.executionOutcome === 'semantic_success')
  if (hasSemanticSuccess) return false
  return tools.some(
    (entry) =>
      (entry.executionOutcome === 'thrown_failure' || entry.executionOutcome === 'structured_failure') &&
      !entry.recoveredSameTurn,
  )
}

const lastLlmKind = (evidence: readonly RephraseTerminalEvidence[]): 'llm_completed' | 'llm_failed' | null => {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const entry = evidence[index]
    if (entry !== undefined && (entry.kind === 'llm_completed' || entry.kind === 'llm_failed')) {
      return entry.kind
    }
  }
  return null
}

export const resolveRephraseTerminalOutcome = (
  evidence: readonly RephraseTerminalEvidence[],
  classify: RephraseOutcomeClassifier = classifyHybrid,
): RephraseTurnOutcome => {
  const tools = evidence.filter((entry): entry is ToolEvidence => entry.kind === 'tool_completed')
  if (isClarification(tools)) return 'clarification'
  const llmKind = lastLlmKind(evidence)
  if (llmKind === 'llm_failed') return 'failure'
  if (isUnrecoveredFailure(tools)) return 'failure'
  if (evidence.length === 0) return 'discard'
  const prediction = classify({
    tool_trace: tools.map((entry) => ({ tool_slug: toClassifierToolSlug(entry.toolSlug) })),
    feature_events: [],
    command_family: 'none',
  })
  if (prediction.abstained || prediction.primary === 'no_action' || prediction.primary === 'unknown') {
    return 'no_action'
  }
  if (llmKind === 'llm_completed' && tools.some((entry) => entry.executionOutcome === 'semantic_success')) {
    return 'success'
  }
  return 'discard'
}
