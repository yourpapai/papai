import { generateText } from 'ai'

import type { ReplyFn } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'
import { emitLlmEnd, emitLlmStart } from './llm-orchestrator-events.js'
import { handleToolCallFinish } from './llm-orchestrator-support.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { withReplyTypingHeartbeat } from './reply-typing-heartbeat.js'
import { buildSystemPrompt } from './system-prompt.js'
import { buildToolFailureResult, isToolFailureResult } from './tool-failure.js'

const buildToolCallStartHandler =
  (contextId: string, turnId: string): Parameters<typeof generateText>[0]['experimental_onToolCallStart'] =>
  (event) => {
    emitUser(
      'tool:request',
      contextId,
      {
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        args: event.toolCall.input,
      },
      turnId,
    )
  }

const emitFailureClassified = (
  contextId: string,
  turnId: string,
  event: { success: boolean; output?: unknown; error?: unknown; toolCall: { toolName: string; toolCallId: string } },
): void => {
  if (event.success && isToolFailureResult(event.output)) {
    const failure = event.output
    emitUser(
      'tool:failure_classified',
      contextId,
      {
        toolName: failure.toolName,
        toolCallId: failure.toolCallId,
        errorType: failure.errorType,
        errorCode: failure.errorCode,
        retryable: failure.retryable,
        recovered: failure.recovered ?? false,
      },
      turnId,
    )
  } else if (!event.success) {
    const failure = buildToolFailureResult(event.error, event.toolCall.toolName, event.toolCall.toolCallId)
    emitUser(
      'tool:failure_classified',
      contextId,
      {
        toolName: failure.toolName,
        toolCallId: failure.toolCallId,
        errorType: failure.errorType,
        errorCode: failure.errorCode,
        retryable: failure.retryable,
        recovered: failure.recovered ?? false,
      },
      turnId,
    )
  }
}

const buildToolCallFinishHandler =
  (
    contextId: string,
    reply: ReplyFn | undefined,
    turnId: string,
  ): Parameters<typeof generateText>[0]['experimental_onToolCallFinish'] =>
  (event) => {
    emitUser(
      'tool:execute_end',
      contextId,
      {
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        success: event.success,
        durationMs: event.durationMs,
      },
      turnId,
    )
    emitFailureClassified(contextId, turnId, event)
    handleToolCallFinish(contextId, reply, event)
  }

export const invokeModel = async (
  args: InvokeModelArgs & { reply: ReplyFn | undefined; turnId: string },
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  const { contextId, mainModel, model, provider, tools, messages, deps, reply, turnId } = args
  const start = Date.now()
  emitLlmStart(contextId, mainModel, messages, tools, args.toolRouting, turnId)
  const result = await deps.generateText({
    model,
    system: buildSystemPrompt(provider, contextId),
    messages,
    tools,
    timeout: 1_200_000,
    stopWhen: deps.stepCountIs(25),
    experimental_onToolCallStart: buildToolCallStartHandler(contextId, turnId),
    experimental_onToolCallFinish: buildToolCallFinishHandler(contextId, reply, turnId),
  })
  emitLlmEnd(contextId, mainModel, result, start, messages, tools, args.toolRouting, turnId)
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
