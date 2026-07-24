// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText } from 'ai'

import { emitUser } from './debug/event-bus.js'
import { handleToolCallFinish } from './llm-orchestrator-support.js'
import { classifyToolTerminal } from './llm-orchestrator-tool-terminal.js'
import type { ToolTerminalClassification } from './llm-orchestrator-tool-terminal.js'
import type { ToolCallContext } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { buildToolFailureResult, isToolFailureResult } from './tool-failure.js'
import type { ToolFailureResult } from './tool-failure.js'

const log = logger.child({ scope: 'llm-orchestrator:tool-events' })

const safeByteLength = (value: unknown): number | null => {
  if (value === undefined || value === null) return null
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return null
  }
}

const contextEnvelope = (
  ctx: ToolCallContext,
): {
  chatUserId: string
  contextType: 'dm' | 'group'
  model: string
  modelRole: 'main' | 'small'
} => ({
  chatUserId: ctx.chatUserId,
  contextType: ctx.contextType,
  model: ctx.model,
  modelRole: ctx.modelRole,
})

export type ToolCallStartEvent = {
  toolCall: { toolName: string; toolCallId: string; input: unknown }
}

export type ToolCallFinishEvent = {
  toolCall: { toolName: string; toolCallId: string; input: unknown }
  durationMs: number
  success: boolean
} & Partial<Record<'output' | 'error', unknown>>

const reportToolStarted = (ctx: ToolCallContext, event: ToolCallStartEvent): void => {
  if (ctx.progressReporter === undefined) return
  try {
    ctx.progressReporter.toolStarted({
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      input: event.toolCall.input,
    })
  } catch (error) {
    log.warn(
      {
        contextId: ctx.contextId,
        toolName: event.toolCall.toolName,
        error: error instanceof Error ? error.message : String(error),
      },
      'AI progress reporter failed on tool start',
    )
  }
}

const reportToolFinished = (ctx: ToolCallContext, event: ToolCallFinishEvent): void => {
  if (ctx.progressReporter === undefined) return
  try {
    ctx.progressReporter.toolFinished({
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      input: event.toolCall.input,
      durationMs: event.durationMs,
      success: event.success,
      output: event.output,
      error: event.error,
    })
  } catch (error) {
    log.warn(
      {
        contextId: ctx.contextId,
        toolName: event.toolCall.toolName,
        error: error instanceof Error ? error.message : String(error),
      },
      'AI progress reporter failed on tool finish',
    )
  }
}

export const handleToolCallStart = (ctx: ToolCallContext, event: ToolCallStartEvent): void => {
  emitUser(
    'tool:request',
    ctx.contextId,
    {
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      argsBytes: safeByteLength(event.toolCall.input),
      analyticsSourceId: analyticsSourceIdOf(ctx, event.toolCall.toolCallId),
      ...contextEnvelope(ctx),
    },
    ctx.turnId,
  )
  reportToolStarted(ctx, event)
  ctx.liveStatus?.onToolStart({ toolName: event.toolCall.toolName, input: event.toolCall.input })
}

export const buildToolCallStartHandler =
  (ctx: ToolCallContext): Parameters<typeof generateText>[0]['onToolExecutionStart'] =>
  (event) => {
    handleToolCallStart(ctx, {
      toolCall: {
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        input: event.toolCall.input,
      },
    })
  }

// AI SDK v7 delivers a `ToolExecutionEndEvent` (toolExecutionMs + a discriminated
// `toolOutput`); map it onto the internal ToolCallFinishEvent shape consumed by
// the debug/progress plumbing.
type ToolExecutionEndArg = Parameters<NonNullable<Parameters<typeof generateText>[0]['onToolExecutionEnd']>>[0]

const adaptToolExecutionEnd = (event: ToolExecutionEndArg): ToolCallFinishEvent => {
  const success = event.toolOutput.type === 'tool-result'
  return {
    toolCall: {
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      input: event.toolCall.input,
    },
    durationMs: event.toolExecutionMs,
    success,
    ...(event.toolOutput.type === 'tool-result'
      ? { output: event.toolOutput.output }
      : { error: event.toolOutput.error }),
  }
}

const emitFailureClassified = (ctx: ToolCallContext, failure: ToolFailureResult | null): void => {
  if (failure === null) return
  emitUser(
    'tool:failure_classified',
    ctx.contextId,
    {
      toolName: failure.toolName,
      toolCallId: failure.toolCallId,
      errorType: failure.errorType,
      errorCode: failure.errorCode,
      retryable: failure.retryable,
      recovered: failure.recovered ?? false,
      ...contextEnvelope(ctx),
    },
    ctx.turnId,
  )
}

/** One stable analytics source id per tool-call lifecycle, created at tool-request start. */
const analyticsSourceIdOf = (ctx: ToolCallContext, toolCallId: string): string => `${ctx.turnId}:${toolCallId}`

/**
 * Exactly-one guard for the analytics terminal: a retried or repeated finish callback
 * for the same tool-call lifecycle must not emit a second terminal. Keyed on the
 * per-attempt context object so independent attempts never share state.
 */
const terminatedToolCalls = new WeakMap<ToolCallContext, Set<string>>()

const alreadyTerminated = (ctx: ToolCallContext, toolCallId: string): boolean => {
  const existing = terminatedToolCalls.get(ctx)
  if (existing !== undefined) return existing.has(toolCallId)
  return false
}

const markTerminated = (ctx: ToolCallContext, toolCallId: string): void => {
  const existing = terminatedToolCalls.get(ctx)
  if (existing !== undefined) {
    existing.add(toolCallId)
    return
  }
  terminatedToolCalls.set(ctx, new Set([toolCallId]))
}

const emitAnalyticsCompleted = (
  ctx: ToolCallContext,
  event: ToolCallFinishEvent,
  terminal: ToolTerminalClassification,
): void => {
  emitUser(
    'tool:analytics_completed',
    ctx.contextId,
    {
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      analyticsSourceId: analyticsSourceIdOf(ctx, event.toolCall.toolCallId),
      durationMs: event.durationMs,
      executionOutcome: terminal.outcome,
      argsBytes: safeByteLength(event.toolCall.input),
      resultBytes: event.success ? (safeByteLength(event.output) ?? 0) : 0,
      errorClass: terminal.errorClass,
      statusClass: terminal.statusClass,
      retryable: terminal.retryable,
      recoveredSameTurn: terminal.recoveredSameTurn,
      ...contextEnvelope(ctx),
    },
    ctx.turnId,
  )
}

export const handleToolCallFinishEvent = (ctx: ToolCallContext, event: ToolCallFinishEvent): void => {
  const failure = event.success
    ? isToolFailureResult(event.output)
      ? event.output
      : null
    : buildToolFailureResult(event.error, event.toolCall.toolName, event.toolCall.toolCallId)
  emitUser(
    'tool:execute_end',
    ctx.contextId,
    {
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      success: event.success,
      durationMs: event.durationMs,
      argsBytes: safeByteLength(event.toolCall.input),
      resultBytes: event.success ? safeByteLength(event.output) : null,
      ...contextEnvelope(ctx),
    },
    ctx.turnId,
  )
  emitFailureClassified(ctx, failure)
  if (!alreadyTerminated(ctx, event.toolCall.toolCallId)) {
    markTerminated(ctx, event.toolCall.toolCallId)
    emitAnalyticsCompleted(ctx, event, classifyToolTerminal({ success: event.success, output: event.output }, failure))
  }
  reportToolFinished(ctx, event)
  ctx.liveStatus?.onToolFinish()
  handleToolCallFinish(ctx.contextId, undefined, event)
}

export const buildToolCallFinishHandler =
  (ctx: ToolCallContext): Parameters<typeof generateText>[0]['onToolExecutionEnd'] =>
  (event) => {
    handleToolCallFinishEvent(ctx, adaptToolExecutionEnd(event))
  }
