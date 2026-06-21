// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getAiOutputSettings } from './ai-output-settings.js'
import { createAiProgressReporter, type AiProgressReporter } from './ai-progress-reporter.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ReplyFn } from './chat/types.js'
import { appendHistory } from './history.js'
import { getIdentityMapping } from './identity/mapping.js'
import { attemptAutoLink } from './identity/resolver.js'
import { resolveEffectiveLlmConfig, type EffectiveLlmConfig } from './llm-config-resolver.js'
import { appendAssistantTurnHistory } from './llm-history.js'
import { getOpenAICompatibleProvider } from './llm-model-builder.js'
import { checkRequiredProviderConfig, resolveConfigId } from './llm-orchestrator-config.js'
import { buildHistory } from './llm-orchestrator-history.js'
import {
  resolveAttachmentIds,
  resolveDeps,
  resolveTurnId,
  type ProcessMessageRest,
} from './llm-orchestrator-process-args.js'
import { handleLlmTurnError, invokeWithLiveStatus, logProcessMessage } from './llm-orchestrator-support.js'
import { buildLlmInvocationOpts, prepareLlmInvocation, type InvocationSource } from './llm-orchestrator-tools.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { maybeAutoProvisionProvider } from './providers/auto-provision.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import { runRegistry } from './run-control/registry.js'
import { buildStopSummary } from './run-control/summary.js'
import { RunAbortedError, type InjectedMessage } from './run-control/types.js'
import { missingSystemConfigKeys } from './system-config.js'

const log = logger.child({ scope: 'llm-orchestrator' })

export const resolveAiOutputSettingsContextId = (contextId: string): string =>
  getConfigContextIdFromStorageContextId(contextId)

export const defaultDeps: LlmOrchestratorDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildOpenAI: (apiKey: string, baseURL: string) => getOpenAICompatibleProvider(apiKey, baseURL),
  resolve: (contextId: string) => defaultTaskProviderResolver.resolve(contextId),
  maybeAutoProvision: (reply, contextId, chatUserId, username) =>
    maybeAutoProvisionProvider(reply, contextId, chatUserId, username),
}

const maybeAutoLinkIdentity = async (
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
): Promise<void> => {
  if (username === null || provider.identityResolver === undefined) return
  const existingMapping = getIdentityMapping(chatUserId, provider.name)
  if (existingMapping !== null) return
  log.debug({ chatUserId, username }, 'Attempting auto-link for first group interaction')
  const autoLinkResult = await attemptAutoLink(chatUserId, username, provider)
  if (autoLinkResult.type === 'found') {
    log.info({ chatUserId, login: autoLinkResult.identity.login }, 'Auto-linked user on first interaction')
  } else {
    log.debug({ chatUserId, username, result: autoLinkResult.type }, 'Auto-link did not find match')
  }
}

const ensureRequiredConfig = async (reply: ReplyFn, contextId: string, configId: string): Promise<void> => {
  const missing = checkRequiredProviderConfig(configId)
  if (missing.length === 0) return
  log.warn({ contextId, configId, missing }, 'Missing required provider config keys')
  await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /config to finish setup in the settings web UI.`)
  throw new Error('Missing configuration')
}
let botMisconfiguredNotified = false

const replyBotMisconfigured = async (reply: ReplyFn, contextId: string): Promise<void> => {
  const missing = missingSystemConfigKeys()
  log.error({ contextId, missing }, 'system_config is incomplete; bot cannot serve this turn')
  await reply.text(
    '⚠️ The bot is not fully configured. Ask the administrator to run /config and complete setup in the web UI.',
  )
  if (!botMisconfiguredNotified) {
    botMisconfiguredNotified = true
    log.warn({ missing }, 'admin notification suppressed for subsequent turns in this process')
  }
}

type LlmConfigFailure = Exclude<ReturnType<typeof resolveEffectiveLlmConfig>, EffectiveLlmConfig>
type ResolvedTurnLlmConfig = EffectiveLlmConfig | null

async function replyByokConfigProblem(reply: ReplyFn, contextId: string, result: LlmConfigFailure): Promise<void> {
  if (result.type === 'missing') {
    log.warn({ contextId, missing: result.missing }, 'BYOK LLM config is incomplete; bot cannot serve this turn')
    await reply.text(
      `BYOK is enabled for this context, but LLM setup is incomplete. Missing: ${result.missing.join(', ')}. Use /config to finish BYOK setup in the settings web UI.`,
    )
    return
  }
  log.warn({ contextId }, 'BYOK LLM config is unreadable; bot cannot serve this turn')
  await reply.text(
    'BYOK credentials for this context are unreadable. Use /config to re-enter the BYOK LLM credentials in the settings web UI.',
  )
}

async function resolveLlmForTurn(reply: ReplyFn, contextId: string, configId: string): Promise<ResolvedTurnLlmConfig> {
  const resolvedLlm = resolveEffectiveLlmConfig(configId)
  if (resolvedLlm.ok) return resolvedLlm
  if (resolvedLlm.source === 'global') {
    await replyBotMisconfigured(reply, contextId)
    return null
  }
  await replyByokConfigProblem(reply, contextId, resolvedLlm)
  return null
}

/** Test-only helper to reset the admin-notified guard between tests. */
export const resetBotMisconfiguredNotifiedForTesting = (): void => {
  botMisconfiguredNotified = false
}

const createProgressReporterForContext = (reply: ReplyFn, contextId: string): AiProgressReporter =>
  createAiProgressReporter(reply, getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)))

type CallLlmArgs = InvocationSource & {
  deps: LlmOrchestratorDeps
  configId: string
  resolvedLlm: EffectiveLlmConfig
  turnId: string
}

const callLlm = async (args: CallLlmArgs): Promise<{ response: { messages: ModelMessage[] } }> => {
  const { reply, contextId, chatUserId, username, contextType, deps, configId, resolvedLlm, turnId } = args
  if (contextType === 'dm') {
    try {
      await deps.maybeAutoProvision(reply, configId, chatUserId, username)
    } catch {
      // Auto-provision is opportunistic; missing or broken hooks should fall through to normal setup guidance.
    }
  }
  const { llmApiKey, llmBaseUrl, mainModel } = resolvedLlm
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = await deps.resolve(configId)
  if (provider === null) {
    log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn; using providerless fallback')
  } else {
    await ensureRequiredConfig(reply, contextId, configId)
    await maybeAutoLinkIdentity(chatUserId, username, provider)
  }
  const invocationOpts = buildLlmInvocationOpts(args, configId, provider, deps.stagedDownloadFn)
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
  startedAt: number
}

const runTurn = async (args: RunTurnArgs): Promise<InjectedMessage[]> => {
  const { invocationSource, turn, deps, configId, resolvedLlm, resolvedTurnId, startedAt } = args
  const { reply, contextId, contextType, actorRole } = invocationSource
  const run = runRegistry.begin(contextId, { turnId: resolvedTurnId, reply })
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
    appendAssistantTurnHistory(
      contextId,
      configId,
      resolvedLlm.mainModel,
      turn.baseHistory,
      turn.historyMessage,
      result.response.messages,
      contextType,
      actorRole,
    )
    if (run.stopRequested) await reply.formatted(buildStopSummary(run.completedEffects, { forced: false }))
  } catch (error) {
    if (error instanceof RunAbortedError) {
      await reply.formatted(buildStopSummary(error.effects, { forced: true }))
    } else {
      await handleLlmTurnError({
        ...invocationSource,
        mainModel: resolvedLlm.mainModel,
        startedAt,
        baseHistory: turn.baseHistory,
        error,
        turnId: resolvedTurnId,
      })
    }
  } finally {
    leftover = runRegistry.end(contextId)
  }
  return leftover
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
  const [configContextId, depsInput, newAttachmentIdsInput, turnId, actorRole = 'member'] = rest
  const deps = resolveDeps(depsInput, defaultDeps)
  const newAttachmentIds = resolveAttachmentIds(newAttachmentIdsInput)
  const resolvedTurnId = resolveTurnId(turnId)
  logProcessMessage(contextId, configContextId, chatUserId, userText, newAttachmentIds, resolvedTurnId)
  const configId = resolveConfigId(contextId, configContextId)
  const resolvedLlm = await resolveLlmForTurn(reply, contextId, configId)
  if (resolvedLlm === null) return
  const turn = await buildHistory(contextId, chatUserId, resolvedLlm.mainModel, userText, newAttachmentIds)
  const invocationSource = { reply, contextId, chatUserId, username, userText, contextType, actorRole }
  appendHistory(contextId, [turn.historyMessage])
  const leftover = await runTurn({
    invocationSource,
    turn,
    deps,
    configId,
    resolvedLlm,
    resolvedTurnId,
    startedAt: Date.now(),
  })
  // Any steer message that never reached a step boundary becomes a fresh turn (never dropped).
  if (leftover.length > 0) {
    const text = leftover.map((m) => m.text).join('\n\n')
    await processMessage(
      reply,
      contextId,
      chatUserId,
      username,
      text,
      contextType,
      configContextId,
      deps,
      [],
      undefined,
      actorRole,
    )
  }
}
