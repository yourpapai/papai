// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TraceFinalClassification, TraceScriptStep } from './fixture-types.js'

export interface ScriptedToolCall {
  readonly toolName: string
  readonly toolCallId: string
  readonly input: unknown
  readonly output?: unknown
  readonly error?: string
}

export interface ScriptedTrace {
  readonly toolCalls: readonly ScriptedToolCall[]
  readonly finalText: string
}

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

  return { toolCalls, finalText }
}

export function classifyFinalReply(text: string): TraceFinalClassification {
  const lower = text.toLowerCase()
  if (lower.includes('which one') || lower.includes('which task')) return 'asks_clarification'
  if (lower.includes('delete') && lower.includes('?')) return 'asks_confirmation'
  if (lower.includes('permission')) return 'requests_permission'
  if (lower.includes('try again') || lower.includes('rate-limiting')) return 'reports_retryable_failure'
  if (lower.includes('cannot') || lower.includes('not configured')) return 'reports_non_retryable_failure'
  if (lower.includes('unsafe') || lower.includes('cannot do that')) return 'declines_unsafe_action'
  if (lower.trim() === '' || lower.includes('no tool')) return 'answers_without_tools'
  return 'completes_action'
}
