// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText } from 'ai'

import type { AiProgressReporter } from './ai-progress-reporter.js'
import type { ReplyFn } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'
import { emitLlmEnd, emitLlmStart } from './llm-orchestrator-events.js'
import { handleToolCallFinish } from './llm-orchestrator-support.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { withReplyTypingHeartbeat } from './reply-typing-heartbeat.js'
import { buildSystemPrompt } from './system-prompt.js'
import { buildToolFailureResult, isToolFailureResult } from './tool-failure.js'

export type ToolCallContext = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  model: string
  modelRole: 'main' | 'small'
  turnId: string
  progressReporter?: AiProgressReporter
}

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
): { chatUserId: string; contextType: 'dm' | 'group'; model: string; modelRole: 'main' | 'small' } => ({
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
  output?: unknown
  error?: unknown
}

export const handleToolCallStart = (ctx: ToolCallContext, event: ToolCallStartEvent): void => {
  emitUser(
    'tool:request',
    ctx.contextId,
    {
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      argsBytes: safeByteLength(event.toolCall.input),
      ...contextEnvelope(ctx),
    },
    ctx.turnId,
  )
  ctx.progressReporter?.toolStarted({
    toolName: event.toolCall.toolName,
    toolCallId: event.toolCall.toolCallId,
    input: event.toolCall.input,
  })
}

export const buildToolCallStartHandler =
  (ctx: ToolCallContext): Parameters<typeof generateText>[0]['experimental_onToolCallStart'] =>
  (event) => {
    handleToolCallStart(ctx, event)
  }

const emitFailureClassified = (
  ctx: ToolCallContext,
  event: { success: boolean; output?: unknown; error?: unknown; toolCall: { toolName: string; toolCallId: string } },
): void => {
  if (event.success && isToolFailureResult(event.output)) {
    const failure = event.output
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
  } else if (!event.success) {
    const failure = buildToolFailureResult(event.error, event.toolCall.toolName, event.toolCall.toolCallId)
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
}

export const handleToolCallFinishEvent = (
  ctx: ToolCallContext,
  reply: ReplyFn | undefined,
  event: ToolCallFinishEvent,
): void => {
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
  emitFailureClassified(ctx, event)
  ctx.progressReporter?.toolFinished({
    toolName: event.toolCall.toolName,
    toolCallId: event.toolCall.toolCallId,
    input: event.toolCall.input,
    durationMs: event.durationMs,
    success: event.success,
    output: event.output,
    error: event.error,
  })
  handleToolCallFinish(ctx.contextId, undefined, event)
}

export const buildToolCallFinishHandler =
  (
    ctx: ToolCallContext,
    reply: ReplyFn | undefined,
  ): Parameters<typeof generateText>[0]['experimental_onToolCallFinish'] =>
  (event) => {
    handleToolCallFinishEvent(ctx, reply, event)
  }

export const invokeModel = async (
  args: InvokeModelArgs & { reply: ReplyFn | undefined; turnId: string },
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  const { contextId, chatUserId, contextType, mainModel, model, provider, tools, messages, deps, reply, turnId } = args
  const start = Date.now()
  emitLlmStart(contextId, mainModel, messages, tools, args.toolRouting, turnId)
  const ctx: ToolCallContext = {
    contextId,
    chatUserId,
    contextType,
    model: mainModel,
    modelRole: 'main',
    turnId,
    progressReporter: args.progressReporter,
  }
  const result = await deps.generateText({
    model,
    system: buildSystemPrompt(provider, contextId),
    messages,
    tools,
    timeout: 1_200_000,
    stopWhen: deps.stepCountIs(25),
    experimental_onToolCallStart: buildToolCallStartHandler(ctx),
    experimental_onToolCallFinish: buildToolCallFinishHandler(ctx, reply),
  })
  emitLlmEnd(contextId, chatUserId, contextType, mainModel, result, start, messages, tools, args.toolRouting, turnId)
  return result
}

export const invokeModelWithTyping = (
  reply: ReplyFn,
  args: InvokeModelArgs & { turnId: string },
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  return withReplyTypingHeartbeat(reply, (typingReply) => invokeModel({ ...args, reply: typingReply }), {
    intervalMs: undefined,
    turnId: args.turnId,
    userId: args.contextId,
  })
}
