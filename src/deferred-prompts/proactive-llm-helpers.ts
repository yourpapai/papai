// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { generateText, isStepCount, LanguageModel, ModelMessage, ToolSet } from 'ai'

import type { ProviderRequestScope } from '../analytics/provider-request-scope.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import {
  buildVerifiedCompletion,
  detectToolFailure,
  selectReadOnlyTools,
  turnHasToolActivity,
  VERIFIER_MAX_STEPS,
} from '../completion/verified-completion.js'
import type { VerifierDeps, VerifierPrompt } from '../completion/verified-completion.js'
import { emitUser } from '../debug/event-bus.js'
import { t, type Locale } from '../i18n/index.js'
import { hoistSystemMessages } from '../llm-message-utils.js'
import { emitLlmEnd, emitLlmStart } from '../llm-orchestrator-events.js'
import { emitLlmError } from '../llm-orchestrator-logging.js'
import { collectTurnMessages, type TurnMessagesResult } from '../llm-orchestrator-messages.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../system-prompt.js'
import type { DisclosureSession } from '../tools/disclosure/registry.js'
import { buildToolsContextRecord } from '../tools/wrap-tool-execution.js'
import type { LlmConfig } from './proactive-llm-config.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm-helpers' })

export const buildProactiveVerification = (
  deps: { generateText: typeof generateText; stepCountIs: typeof isStepCount },
  model: LanguageModel,
  tools: ToolSet,
  history: readonly ModelMessage[],
  scope: ProviderRequestScope,
): { verifier: VerifierDeps; history: readonly ModelMessage[] } => {
  const readOnlyToolset = selectReadOnlyTools(tools)
  // Independently built keyed toolsContext for the proactive verifier call.
  const verifierToolsContext = buildToolsContextRecord(readOnlyToolset ?? {}, scope)
  const verifier: VerifierDeps = {
    readOnlyToolset,
    invokeVerifier: async ({ system, messages }: VerifierPrompt) => {
      const baseOptions: Parameters<typeof generateText>[0] = {
        model,
        ...hoistSystemMessages(system, messages),
        tools: readOnlyToolset ?? {},
        stopWhen: deps.stepCountIs(VERIFIER_MAX_STEPS),
        timeout: 1_200_000,
      }
      const res = await deps.generateText(Object.assign({}, baseOptions, { toolsContext: verifierToolsContext }))
      return { text: res.text, finishReason: res.finishReason }
    },
  }
  return { verifier, history }
}

export type ProactiveLlmDispatchBaseArgs<TBuildProvider> = readonly [
  DeferredExecutionContextLike,
  'scheduled' | 'alert',
  string,
  ExecutionMetadata,
  TBuildProvider,
]
export type ProactiveLlmDispatchArgs<TDeps, TBuildProvider> =
  | ProactiveLlmDispatchBaseArgs<TBuildProvider>
  | readonly [...ProactiveLlmDispatchBaseArgs<TBuildProvider>, string]
  | readonly [...ProactiveLlmDispatchBaseArgs<TBuildProvider>, undefined, TDeps]
  | readonly [...ProactiveLlmDispatchBaseArgs<TBuildProvider>, string, TDeps]

type DeferredExecutionContextLike = Readonly<{
  createdByUserId: string
  deliveryTarget: DeferredDeliveryTarget
}>

export type BuildProviderFn = (
  contextId: string,
  taskInstanceId?: string | null,
) => Promise<TaskProvider | null> | TaskProvider | null

export const getConfigContextId = (execCtx: DeferredExecutionContextLike): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(execCtx.deliveryTarget))

export type FullGenerationInput = Readonly<{
  storageContextId: string
  tools: ToolSet
  systemPrompt: string
  messages: ModelMessage[]
  disclosure: DisclosureSession
}>

/** Minimal view of an LLM result needed to decide the user-facing delivery text. */
export type DeliveryResultLike = Readonly<{
  text: string | undefined
  finishReason?: string
  steps?: readonly unknown[]
}>

/**
 * Decide the text to deliver for a fired deferred prompt.
 *
 * A `tool-calls` finish reason means the turn was cut off mid-tool-step (e.g. the model
 * emitted a "let me check the time" preamble and called get_current_time, but the step
 * budget stopped the turn before it produced the real reply). In that case the only text
 * is a preamble, never the answer — drop it instead of leaking it to the user.
 */
export const finalizeDeliveryText = (result: DeliveryResultLike, locale?: Locale): string => {
  if (result.finishReason === 'tool-calls') return t('completion.doneFallback', locale)
  if (result.text === undefined || result.text === '') return t('completion.doneFallback', locale)
  return result.text
}

/**
 * Debug-trace emission parity with invokeModel (llm:start/end/error): the proof
 * checks correlate the run's own trace from recentLlm, so the proactive execution
 * must land one. chatUserId is the prompt owner's native chat user id (the
 * delivery target's context id only for DM targets, where the two coincide),
 * which is what findOwnTrace attributes against — and what usage recording
 * treats as the real chat actor, so group-targeted prompts must not land their
 * spend on the group id.
 */
export const generateWithTrace = async (
  execCtx: DeferredExecutionContextLike,
  config: LlmConfig,
  prepared: FullGenerationInput,
  deps: { generateText: typeof generateText },
  scope: ProviderRequestScope,
  turnId: string,
  baseOptions: Parameters<typeof generateText>[0],
): Promise<Awaited<ReturnType<typeof generateText>>> => {
  const start = Date.now()
  emitLlmStart(prepared.storageContextId, config.mainModel, prepared.messages, prepared.tools, turnId)
  try {
    const result = await deps.generateText(
      Object.assign({}, baseOptions, { toolsContext: buildToolsContextRecord(prepared.tools, scope) }),
    )
    emitLlmEnd(
      prepared.storageContextId,
      execCtx.deliveryTarget.createdByUserId,
      execCtx.deliveryTarget.contextType,
      config.mainModel,
      result,
      start,
      prepared.messages,
      prepared.tools,
      turnId,
    )
    return result
  } catch (error) {
    emitLlmError(
      prepared.storageContextId,
      execCtx.deliveryTarget.createdByUserId,
      execCtx.deliveryTarget.contextType,
      config.mainModel,
      start,
      prepared.messages.length,
      error,
      turnId,
    )
    throw error
  }
}

type ProactiveVerificationArg = {
  verifier: VerifierDeps
  history: readonly ModelMessage[]
  /** Correlates the follow-up llm:verifier event with the turn's llm:end trace. */
  turnId?: string
  /** The user scope the path's own llm:start/end events used (the storage context id). */
  traceScope?: string
}

/**
 * Risky-turn verify-and-report leg: runs the verifier, emits the llm:verifier trace
 * event with the path's own scope and turnId, logs the outcome, and returns the
 * verified text. Returns undefined when the turn is not risky (no verification).
 */
const verifyRiskyTurn = async (
  result: DeliveryResultLike & TurnMessagesResult,
  verification: ProactiveVerificationArg,
  userId: string,
  locale?: Locale,
): Promise<string | undefined> => {
  const turnMessages = collectTurnMessages(result)
  const hadToolFailure = detectToolFailure(turnMessages)
  const hadToolActivity = turnHasToolActivity(turnMessages)
  const isRisky =
    result.text === undefined || result.text === '' || result.finishReason === 'tool-calls' || hadToolFailure
  if (!isRisky) return undefined
  const verified = await buildVerifiedCompletion(
    {
      history: verification.history,
      finishReason: result.finishReason,
      hadToolFailure,
      hadToolActivity,
      finalText: result.text,
      locale,
    },
    verification.verifier,
  )
  if (verification.turnId !== undefined && verification.traceScope !== undefined) {
    emitUser(
      'llm:verifier',
      verification.traceScope,
      { verifierOutcome: verified.verifierOutcome },
      verification.turnId,
    )
  }
  log.info(
    { userId, verifierOutcome: verified.verifierOutcome, verdict: verified.verdict },
    'Proactive verification finished',
  )
  return verified.text
}

/**
 * Resolve the user-facing delivery text and log the turn's completion shape. Warns when the
 * turn ended on a pending tool call, because a delivered reminder that stopped mid-tool-step
 * is provably incomplete (its text is a preamble, dropped by finalizeDeliveryText).
 *
 * When a `verification` arg is provided and the result looks risky (empty text, pending
 * tool call, or a tool failure), runs a verify-and-report pass before returning.
 */
export const finalizeAndLog = async (
  result: DeliveryResultLike & TurnMessagesResult,
  userId: string,
  verification?: ProactiveVerificationArg,
  locale?: Locale,
): Promise<string> => {
  const stepCount = Array.isArray(result.steps) ? result.steps.length : undefined
  const meta = { userId, finishReason: result.finishReason, stepCount }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'Proactive delivery ended on a pending tool call (step cap reached); verifying before delivery')
  } else {
    log.debug(meta, 'Proactive delivery finalized')
  }

  if (verification !== undefined) {
    const verifiedText = await verifyRiskyTurn(result, verification, userId, locale)
    if (verifiedText !== undefined) return verifiedText
  }
  return finalizeDeliveryText(result, locale)
}

export const timezoneOrUtc = (timezone: string | null): string => {
  if (timezone === null) return 'UTC'
  return timezone
}

export const getStorageContextId = (target: DeferredDeliveryTarget): string => {
  if (target.storageContextId !== undefined) return target.storageContextId
  if (target.contextType === 'group' && target.threadId !== null) return `${target.contextId}:${target.threadId}`
  return target.contextId
}

export function buildMetadataMessages(m: ExecutionMetadata): ModelMessage[] {
  const msgs: ModelMessage[] = [{ role: 'system', content: `[DELIVERY BRIEF]\n${m.delivery_brief}` }]
  if (m.context_snapshot !== null)
    msgs.push({ role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${m.context_snapshot}` })
  return msgs
}

export const buildFullSystemPrompt = (
  provider: TaskProvider | null,
  storageContextId: string,
  enabledToolNames: ReadonlySet<string>,
): string =>
  provider === null
    ? buildProviderlessSystemPrompt(storageContextId, enabledToolNames, {
        askPermissionAvailable: false,
        progressiveDisclosure: true,
      })
    : buildSystemPrompt(provider, storageContextId, enabledToolNames, {
        askPermissionAvailable: false,
        progressiveDisclosure: true,
      })

export async function resolveFullProvider(
  buildProviderFn: BuildProviderFn,
  userId: string,
  storageContextId: string,
  configContextId: string,
): Promise<TaskProvider | null> {
  const provider = await buildProviderFn(configContextId)
  if (provider !== null) return provider
  log.warn({ userId, storageContextId, configContextId }, 'Could not build task provider for deferred prompt')
  return null
}
