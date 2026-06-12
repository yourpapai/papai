// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TraceFinalClassification, TraceScriptStep } from './fixture-types.js'

export const SCRIPTED_FAKE_MODEL_TRACE_SOURCE = 'scripted-fake-model'

export interface ScriptedToolCall {
  readonly toolName: string
  readonly toolCallId: string
  readonly input: unknown
  readonly output?: unknown
  readonly error?: string
}

export interface ScriptedTrace {
  readonly source: typeof SCRIPTED_FAKE_MODEL_TRACE_SOURCE
  readonly toolCalls: readonly ScriptedToolCall[]
  readonly finalText: string
}

/**
 * Deterministic Phase 0 fake model trace source.
 *
 * This is replay-only on purpose: each script step represents the output that a
 * fake generateText seam would have produced, without calling the production
 * orchestrator or a live model.
 */
export function buildScriptedTrace(script: readonly TraceScriptStep[]): ScriptedTrace {
  const toolCalls: ScriptedToolCall[] = []
  let finalText = ''

  for (const step of script) {
    if (step.type === 'assistant_text') {
      finalText = step.text
    } else {
      toolCalls.push({
        toolName: step.toolName,
        toolCallId: step.toolCallId,
        input: step.input,
        output: step.output,
        error: step.error,
      })
    }
  }

  return { source: SCRIPTED_FAKE_MODEL_TRACE_SOURCE, toolCalls, finalText }
}

export function classifyFinalReply(text: string): TraceFinalClassification {
  const lower = text.toLowerCase()
  if (
    lower.includes('which one') ||
    lower.includes('which task') ||
    lower.includes('which project') ||
    lower.includes('which title')
  ) {
    return 'asks_clarification'
  }
  if (lower.includes('delete') && lower.includes('?')) return 'asks_confirmation'
  if (lower.includes('permission')) return 'requests_permission'
  if (lower.includes('try again') || lower.includes('rate-limiting')) return 'reports_retryable_failure'
  if (lower.includes('unsafe') || lower.includes('cannot do that')) return 'declines_unsafe_action'
  if (lower.includes('will not delete') || lower.includes("won't delete")) return 'answers_without_tools'
  if (lower.includes('cannot') || lower.includes('not configured')) return 'reports_non_retryable_failure'
  if (lower.includes('no matching') || lower.includes('no results')) return 'answers_without_tools'
  if (lower.trim() === '' || lower.includes('no tool')) return 'answers_without_tools'
  return 'completes_action'
}
