// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

export function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

export function isTokenRecord(v: unknown): v is { inputTokens: unknown; outputTokens: unknown } {
  return typeof v === 'object' && v !== null && 'inputTokens' in v && 'outputTokens' in v
}

export function tokenUsage(value: unknown): { inputTokens: number; outputTokens: number } {
  if (isTokenRecord(value)) {
    return { inputTokens: num(value.inputTokens), outputTokens: num(value.outputTokens) }
  }
  return { inputTokens: 0, outputTokens: 0 }
}

export type StepToolCallDetail = {
  toolName: string
  toolCallId: string
  args: unknown
  result?: unknown
  error?: string
}

export type StepDetail = {
  stepNumber: number
  text?: string
  finishReason?: string
  toolCalls?: Array<StepToolCallDetail>
  usage?: { inputTokens: number; outputTokens: number }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getRecordValue(value: unknown, key: string): unknown {
  return isRecordLike(value) ? value[key] : undefined
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function parseToolCall(tc: unknown): StepToolCallDetail {
  const call: StepToolCallDetail = {
    toolName: str(getRecordValue(tc, 'toolName')),
    toolCallId: str(getRecordValue(tc, 'toolCallId')),
    args: getRecordValue(tc, 'args'),
  }
  const result = getRecordValue(tc, 'result')
  if (result !== undefined) call.result = result
  const error = optStr(getRecordValue(tc, 'error'))
  if (error !== undefined) call.error = error
  return call
}

/** @public -- consumed by state-collector.handleLlmEnd */
export function parseStepsDetail(rawStepsDetail: unknown): StepDetail[] | undefined {
  if (!Array.isArray(rawStepsDetail)) return undefined
  return rawStepsDetail.map((s: unknown) => {
    const toolCallsValue = getRecordValue(s, 'toolCalls')
    const step: StepDetail = {
      stepNumber: num(getRecordValue(s, 'stepNumber')),
      toolCalls: Array.isArray(toolCallsValue) ? toolCallsValue.map(parseToolCall) : undefined,
      usage: tokenUsage(getRecordValue(s, 'usage')),
    }
    const text = optStr(getRecordValue(s, 'text'))
    if (text !== undefined) step.text = text
    const finishReason = optStr(getRecordValue(s, 'finishReason'))
    if (finishReason !== undefined) step.finishReason = finishReason
    return step
  })
}
