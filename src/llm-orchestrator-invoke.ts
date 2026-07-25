// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from './chat/types.js'
import { hoistSystemMessages } from './llm-message-utils.js'
import { emitLlmEnd, emitLlmStart } from './llm-orchestrator-events.js'
import { buildToolCallFinishHandler, buildToolCallStartHandler } from './llm-orchestrator-tool-events.js'
import type { GenerateArgs, InvokeModelArgs, LlmOrchestratorDeps, ToolCallContext } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { scheduleShadowRecallLog } from './long-term-memory/shadow-log.js'
import { withReplyTypingHeartbeat } from './reply-typing-heartbeat.js'
import { createNoProgressCondition } from './run-control/no-progress-condition.js'
import { runRegistry } from './run-control/registry.js'
import { composePrepareSteps, createSteeringPrepareStep } from './run-control/steering-prepare-step.js'
import { createStopRequestedCondition } from './run-control/stop-condition.js'
import { RunAbortedError } from './run-control/types.js'
import { buildProviderlessSystemPrompt, buildSystemPrompt } from './system-prompt.js'
import { createDisclosurePrepareStep } from './tools/disclosure/prepare-step.js'

// Re-exported for existing importers/tests that reach these through this module.
export {
  handleToolCallFinishEvent,
  handleToolCallStart,
  type ToolCallFinishEvent,
  type ToolCallStartEvent,
} from './llm-orchestrator-tool-events.js'

const log = logger.child({ scope: 'llm-orchestrator:invoke' })

/**
 * Per-turn tool-step budget for the agent loop. A single generateText call loops through
 * all its steps internally (accumulating complete tool-call/result pairs), so this is the
 * total budget for one user turn — not a per-round cap. Kept generous so ordinary requests
 * finish in one turn; the no-progress guard stops a stalled turn well before this.
 */
const AGENT_MAX_STEPS = 50

export const resolveSystemPrompt = (
  args: Pick<InvokeModelArgs, 'provider' | 'contextId' | 'enabledToolNames' | 'disclosure' | 'contextType'>,
): string => {
  const { provider, contextId, enabledToolNames, disclosure, contextType } = args
  const opts = { askPermissionAvailable: true, progressiveDisclosure: disclosure !== undefined, contextType }
  return provider === null
    ? buildProviderlessSystemPrompt(contextId, enabledToolNames, opts)
    : buildSystemPrompt(provider, contextId, enabledToolNames, opts)
}

const callGenerateText = async (a: GenerateArgs): ReturnType<LlmOrchestratorDeps['generateText']> => {
  const { contextId, turnId, model, systemPrompt, messages, tools, deps, disclosure, ctx } = a
  const run = runRegistry.get(contextId)
  const disclosureStep =
    disclosure === undefined ? undefined : createDisclosurePrepareStep(disclosure, contextId, turnId)
  const prepareStep =
    run === undefined ? disclosureStep : composePrepareSteps(createSteeringPrepareStep(run), disclosureStep)
  // Budget cap + no-progress guard always apply; a live force-stop condition is added when a run is active.
  const stopWhen =
    run === undefined
      ? [deps.stepCountIs(AGENT_MAX_STEPS), createNoProgressCondition()]
      : [deps.stepCountIs(AGENT_MAX_STEPS), createNoProgressCondition(), createStopRequestedCondition(run)]
  const finishHandler = buildToolCallFinishHandler(ctx)
  try {
    return await deps.generateText({
      model,
      ...hoistSystemMessages(systemPrompt, messages),
      tools,
      timeout: 1_200_000,
      stopWhen,
      ...(run === undefined ? {} : { abortSignal: run.abortController.signal }),
      onToolExecutionStart: buildToolCallStartHandler(ctx),
      onToolExecutionEnd: (event) => {
        if (run !== undefined) run.completedEffects.push({ toolName: event.toolCall.toolName })
        finishHandler?.(event)
      },
      ...(prepareStep === undefined ? {} : { prepareStep }),
    })
  } catch (error) {
    if (run !== undefined && run.abortController.signal.aborted) {
      log.info({ contextId, turnId }, 'Run force-aborted by user')
      throw new RunAbortedError(run.completedEffects)
    }
    throw error
  }
}

// Off hot path: schedules the memory-recall shadow-logging study (default OFF, sampled)
// in a `queueMicrotask`; returns synchronously and never delays or alters this turn.
const scheduleShadowLogForTurn = (
  args: Pick<InvokeModelArgs, 'contextId' | 'configId' | 'contextType' | 'messages'>,
  mainModel: string,
  turnId: string,
  result: Awaited<ReturnType<LlmOrchestratorDeps['generateText']>>,
): void => {
  scheduleShadowRecallLog({
    contextId: args.contextId,
    configId: args.configId,
    contextType: args.contextType,
    readerModelId: mainModel,
    turnRef: turnId,
    messages: args.messages,
    steps: result.steps,
  })
}

export const invokeModel = async (
  args: InvokeModelArgs & { reply: ReplyFn | undefined; turnId: string },
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  const {
    contextId,
    chatUserId,
    contextType,
    mainModel,
    model,
    provider,
    tools,
    messages,
    deps,
    turnId,
    enabledToolNames,
    disclosure,
  } = args
  const start = Date.now()
  const systemPrompt = resolveSystemPrompt({ provider, contextId, enabledToolNames, disclosure, contextType })
  emitLlmStart(contextId, mainModel, messages, tools, turnId)
  const ctx: ToolCallContext = {
    contextId,
    chatUserId,
    contextType,
    model: mainModel,
    modelRole: 'main',
    turnId,
    progressReporter: args.progressReporter,
    liveStatus: args.liveStatus,
  }
  const result = await callGenerateText({
    contextId,
    turnId,
    model,
    systemPrompt,
    messages,
    tools,
    deps,
    disclosure,
    ctx,
  })
  emitLlmEnd(contextId, chatUserId, contextType, mainModel, result, start, messages, tools, turnId)
  scheduleShadowLogForTurn(args, mainModel, turnId, result)
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
