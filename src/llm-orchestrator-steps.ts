// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StepInput, StepOutput } from './llm-orchestrator-types.js'

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractToolErrorsFromContent(content: ReadonlyArray<unknown> | undefined): Map<string, string> {
  const errors = new Map<string, string>()
  if (content === undefined) return errors
  for (const part of content) {
    if (!isRecordLike(part)) continue
    if (part['type'] !== 'tool-error') continue
    const id = part['toolCallId']
    if (typeof id !== 'string') continue
    const err = part['error']
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    errors.set(id, msg)
  }
  return errors
}

/** @public -- used by llm-orchestrator.emitLlmEnd and exercised by its tests */
export function buildStepsDetail(steps: StepInput[]): StepOutput[] {
  return steps.map((step, index) => {
    const resultMap = new Map<string, unknown>()
    if (step.toolResults !== undefined) {
      for (const r of step.toolResults) {
        if (typeof r.toolCallId === 'string') resultMap.set(r.toolCallId, r.output)
      }
    }
    const errorMap = extractToolErrorsFromContent(step.content)

    const out: StepOutput = {
      stepNumber: index + 1,
      toolCalls: step.toolCalls?.map((tc) => {
        const call: NonNullable<StepOutput['toolCalls']>[number] = {
          toolName: tc.toolName,
          toolCallId: tc.toolCallId,
          args: tc.input,
        }
        const result = resultMap.get(tc.toolCallId)
        if (result !== undefined) call.result = result
        const error = errorMap.get(tc.toolCallId)
        if (error !== undefined) call.error = error
        return call
      }),
      usage: step.usage,
    }
    if (step.text !== undefined && step.text !== '') out.text = step.text
    if (step.finishReason !== undefined && step.finishReason !== '') out.finishReason = step.finishReason
    return out
  })
}
