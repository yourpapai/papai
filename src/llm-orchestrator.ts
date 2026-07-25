// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, isStepCount, type ModelMessage } from 'ai'

import { getAiOutputSettings } from './ai-output-settings.js'
import { createAiProgressReporter, type AiProgressReporter } from './ai-progress-reporter.js'
import { resolveNormalTurnProviderScope } from './analytics/provider-scope-factory.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ReplyFn } from './chat/types.js'
import { appendHistory } from './history.js'
import { maybeAutoLinkIdentity } from './identity/resolver.js'
import { recordAssistantTurn } from './llm-history.js'
import { getOpenAICompatibleProvider } from './llm-model-builder.js'
import { checkRequiredProviderConfig, resolveConfigId } from './llm-orchestrator-config.js'
import { buildHistory } from './llm-orchestrator-history.js'
import { replayLeftoverSteerAsFreshTurn } from './llm-orchestrator-leftover-replay.js'
import { shouldBackstopGroupMembership } from './llm-orchestrator-membership.js'
import { resolveProcessMessageInputs, type ProcessMessageRest } from './llm-orchestrator-process-args.js'
import { resolveLlmForTurn } from './llm-orchestrator-resolve-llm.js'
import { handleLlmTurnError, invokeWithLiveStatus, logProcessMessage } from './llm-orchestrator-support.js'
import { buildLlmInvocationOpts, prepareLlmInvocation, type InvocationSource } from './llm-orchestrator-tools.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import type { EffectiveLlmConfig } from './llm-providers/types.js'
import { logger } from './logger.js'
import { maybeAutoProvisionProvider } from './providers/auto-provision.js'
import { ensureWorkspaceMember } from './providers/membership/index.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import { lastTurnRegistry } from './run-control/last-turn-registry.js'
import { runRegistry } from './run-control/registry.js'
import { buildStopSummary } from './run-control/summary.js'
import { RunAbortedError, type InjectedMessage, type RunControl } from './run-control/types.js'

const log = logger.child({ scope: 'llm-orchestrator' })

export const resolveAiOutputSettingsContextId = (contextId: string): string =>
  getConfigContextIdFromStorageContextId(contextId)

export const defaultDeps: LlmOrchestratorDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => isStepCount(...args),
  buildModel: (config) => getOpenAICompatibleProvider(config.main.apiKey, config.main.baseUrl)(config.main.model),
  resolve: (contextId: string) => defaultTaskProviderResolver.resolve(contextId),
  maybeAutoProvision: (reply, contextId, chatUserId, username) =>
    maybeAutoProvisionProvider(reply, contextId, chatUserId, username),
}

/** Fire-and-forget workspace member provisioning backstop for group contexts. */
const maybeEnsureGroupMembership = (configId: string, chatUserId: string, username: string | null): void => {
  ensureWorkspaceMember(configId, chatUserId, undefined, { username }).catch((err: unknown) => {
    log.warn(
      { chatUserId, error: err instanceof Error ? err.message : String(err) },
      'Backstop ensureWorkspaceMember failed',
    )
  })
}

const ensureRequiredConfig = async (reply: ReplyFn, contextId: string, configId: string): Promise<void> => {
  const missing = checkRequiredProviderConfig(configId)
  if (missing.length === 0) return
  log.warn({ contextId, configId, missing }, 'Missing required provider config keys')
  await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /config to finish setup in the settings web UI.`)
  throw new Error('Missing configuration')
}

// Re-exported from the resolve-llm module so existing tests importing from here keep working.
export { resetBotMisconfiguredNotifiedForTesting } from './llm-orchestrator-resolve-llm.js'

const createProgressReporterForContext = (reply: ReplyFn, contextId: string): AiProgressReporter =>
  createAiProgressReporter(reply, getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)))

type CallLlmArgs = InvocationSource & {
  deps: LlmOrchestratorDeps
  configId: string
  resolvedLlm: EffectiveLlmConfig
  turnId: string
}

// `finishReason` distinguishes a step-cap truncation ('tool-calls') from a normal stop.
type CallLlmResult = {
  finalStep: { response: { messages: ModelMessage[] } }
  finishReason?: string
}

const prepareTurnProvider = async (args: CallLlmArgs): Promise<TaskProvider | null> => {
  const { reply, contextId, chatUserId, username, contextType, actorRole, deps, configId } = args
  if (contextType === 'dm') {
    try {
      await deps.maybeAutoProvision(reply, configId, chatUserId, username)
    } catch {
      // Auto-provision is opportunistic; missing or broken hooks should fall through to normal setup guidance.
    }
  }
  const provider = await deps.resolve(configId)
  if (provider === null) {
    log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn; using providerless fallback')
  } else {
    await ensureRequiredConfig(reply, contextId, configId)
    await maybeAutoLinkIdentity(chatUserId, username, provider)
    if (shouldBackstopGroupMembership(contextType, actorRole))
      maybeEnsureGroupMembership(configId, chatUserId, username)
  }
  return provider
}

const callLlm = async (args: CallLlmArgs): Promise<CallLlmResult> => {
  const { reply, contextId, chatUserId, contextType, deps, configId, resolvedLlm, turnId } = args
  const mainModel = resolvedLlm.main.model
  const model = deps.buildModel(resolvedLlm)
  const provider = await prepareTurnProvider(args)
  // One immutable actor scope per turn, resolved from the authorized-turn
  // registry (falls back to the explicit NO_ANALYTICS_SCOPE sentinel).
  const providerRequestScope = resolveNormalTurnProviderScope(turnId)
  const invocationOpts = buildLlmInvocationOpts(args, configId, provider, deps.stagedDownloadFn, providerRequestScope)
  const invocationOptsWithResolver = {
    ...invocationOpts,
    chatParticipantResolver: deps.chatParticipantResolver,
  }
  const { tools, validatedMessages, enabledToolNames, disclosure } =
    await prepareLlmInvocation(invocationOptsWithResolver)
  const progressReporter = createProgressReporterForContext(reply, contextId)
  const liveStatusEnabled = getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)).liveStatus === 'on'
  return invokeWithLiveStatus({
    reply,
    liveStatusEnabled,
    invokeArgs: {
      contextId,
      chatUserId,
      contextType,
      mainModel,
      model,
      provider,
      tools,
      enabledToolNames,
      messages: validatedMessages,
      deps,
      progressReporter,
      disclosure,
      turnId,
      providerRequestScope,
      analytics: { providerBinding: resolvedLlm.source },
    },
    progressReporter,
  })
}

type RunTurnArgs = {
  invocationSource: Omit<InvocationSource, 'history'>
  turn: Awaited<ReturnType<typeof buildHistory>>
  deps: LlmOrchestratorDeps
  configId: string
  resolvedLlm: EffectiveLlmConfig
  resolvedTurnId: string
  originatingMessageIds: readonly string[]
  startedAt: number
}

const runTurn = async (args: RunTurnArgs): Promise<InjectedMessage[]> => {
  const { invocationSource, turn, deps, configId, resolvedLlm, resolvedTurnId, originatingMessageIds, startedAt } = args
  const { reply, contextId, contextType, actorRole } = invocationSource
  const run = runRegistry.begin(contextId, {
    turnId: resolvedTurnId,
    reply,
    originatingMessageIds,
  })
  let leftover: InjectedMessage[] = []
  try {
    const result = await callLlm({
      ...invocationSource,
      history: [...turn.baseHistory, turn.modelMessage],
      deps,
      configId,
      resolvedLlm,
      turnId: resolvedTurnId,
    })
    const meta = {
      contextId,
      configId,
      mainModel: resolvedLlm.main.model,
      contextType,
      actorRole,
    }
    recordAssistantTurn(meta, turn, result)
    if (run.stopRequested) await reply.formatted(buildStopSummary(run.completedEffects, { forced: false }))
  } catch (error) {
    if (error instanceof RunAbortedError) {
      await reply.formatted(buildStopSummary(error.effects, { forced: true }))
    } else {
      await handleLlmTurnError({
        ...invocationSource,
        mainModel: resolvedLlm.main.model,
        startedAt,
        baseHistory: turn.baseHistory,
        userHistoryMessage: turn.historyMessage,
        error,
        turnId: resolvedTurnId,
      })
    }
  } finally {
    leftover = runRegistry.end(contextId)
    // run is still a valid reference (end() only drops the map entry); capture
    // the finished turn's state so later W2 edit classification can inspect it.
    recordFinishedTurn(contextId, run)
  }
  return leftover
}

const recordFinishedTurn = (
  contextId: string,
  run: Readonly<Pick<RunControl, 'originatingMessageIds' | 'completedEffects' | 'replyTarget'>>,
): void => {
  lastTurnRegistry.record(contextId, {
    originatingMessageIds: run.originatingMessageIds,
    completedEffects: run.completedEffects,
    replyTarget: run.replyTarget,
    finishedAt: Date.now(),
  })
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  contextType: 'dm' | 'group',
  ...rest: ProcessMessageRest
): Promise<void> => {
  const { configContextId, deps, newAttachmentIds, resolvedTurnId, originatingMessageIds, actorRole, segments } =
    resolveProcessMessageInputs(rest, defaultDeps)
  logProcessMessage(contextId, configContextId, chatUserId, userText, newAttachmentIds, resolvedTurnId)
  const configId = resolveConfigId(contextId, configContextId)
  const resolvedLlm = await resolveLlmForTurn(reply, contextId, configId)
  if (resolvedLlm === null) return
  const turn = await buildHistory(
    contextId,
    chatUserId,
    resolvedLlm.main.model,
    userText,
    newAttachmentIds,
    segments,
    contextType,
  )
  const invocationSource = {
    reply,
    contextId,
    chatUserId,
    username,
    userText,
    contextType,
    actorRole,
  }
  appendHistory(contextId, [turn.historyMessage])
  const leftover = await runTurn({
    invocationSource,
    turn,
    deps,
    configId,
    resolvedLlm,
    resolvedTurnId,
    originatingMessageIds,
    startedAt: Date.now(),
  })
  await replayLeftoverSteerAsFreshTurn(leftover, { invocationSource, configContextId, deps, processMessage })
}
