// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { AiProgressReporter } from './ai-progress-reporter.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ReplyFn } from './chat/types.js'
import { buildVerifiedCompletion, detectToolFailure, turnHasToolActivity } from './completion/verified-completion.js'
import type { VerifierDeps, VerifierOutcome } from './completion/verified-completion.js'
import { emitUser } from './debug/event-bus.js'
import { t } from './i18n/index.js'
import { collectTurnMessages, type TurnMessagesResult } from './llm-orchestrator-messages.js'
import { logger } from './logger.js'
import { runRegistry } from './run-control/registry.js'
import { getContextLanguage } from './utils/config-language.js'

const log = logger.child({ scope: 'llm-orchestrator:send' })

type SendResult = TurnMessagesResult & {
  text: string | undefined
  finishReason?: string
  toolCalls: unknown[] | undefined
}
type Verification = {
  verifier: VerifierDeps
  history: readonly ModelMessage[]
  /** Correlates the follow-up llm:verifier event with the turn's llm:end trace. */
  turnId?: string
}

/** Resolve the text to post: a verifier round-trip for risky turns, else the model text (or "Done."). */
const resolveFinalText = async (
  result: SendResult,
  hadToolFailure: boolean,
  hadToolActivity: boolean,
  verification: Verification | undefined,
  contextId: string,
): Promise<{ text: string; verifierOutcome: VerifierOutcome | undefined }> => {
  const isRisky =
    result.text === undefined || result.text === '' || result.finishReason === 'tool-calls' || hadToolFailure
  const locale = getContextLanguage(getConfigContextIdFromStorageContextId(contextId))
  if (isRisky && verification !== undefined) {
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
    return { text: verified.text, verifierOutcome: verified.verifierOutcome }
  }
  return {
    text: result.text !== undefined && result.text !== '' ? result.text : t('completion.doneFallback', locale),
    verifierOutcome: undefined,
  }
}

const flushProgressDetails = async (
  progressReporter: AiProgressReporter | undefined,
  contextId: string,
): Promise<void> => {
  if (progressReporter === undefined) return
  try {
    await progressReporter.flush()
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'AI progress details flush failed after final response',
    )
  }
}

export const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: SendResult,
  progressReporter: AiProgressReporter | undefined,
  verification?: Verification,
  /** Runs once right before the first reply posts (after verification), to dismiss the live-status placeholder. */
  beforeFirstMessage?: () => Promise<void>,
): Promise<void> => {
  const turnMessages = collectTurnMessages(result)
  const hadToolFailure = detectToolFailure(turnMessages)
  const hadToolActivity = turnHasToolActivity(turnMessages)
  const { text: textToFormat, verifierOutcome } = await resolveFinalText(
    result,
    hadToolFailure,
    hadToolActivity,
    verification,
    contextId,
  )
  if (verification?.turnId !== undefined && verifierOutcome !== undefined) {
    emitUser('llm:verifier', contextId, { verifierOutcome }, verification.turnId)
  }

  const modelTextLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  const meta = {
    contextId,
    sentTextLength: textToFormat.length,
    modelTextLength,
    toolCalls: toolCallCount,
    finishReason: result.finishReason,
    ...(verifierOutcome === undefined ? {} : { verifierOutcome }),
  }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'LLM turn ended on a pending tool call (step cap reached); reply may be incomplete')
  }
  if (beforeFirstMessage !== undefined) await beforeFirstMessage()
  await reply.formatted(textToFormat)
  recordReplyTarget(contextId, reply)
  await flushProgressDetails(progressReporter, contextId)
  log.info(meta, 'Response sent successfully')
}

const recordReplyTarget = (contextId: string, reply: ReplyFn): void => {
  if (reply.lastReplyTarget === undefined) return
  const run = runRegistry.get(contextId)
  if (run === undefined) return
  run.replyTarget = reply.lastReplyTarget()
}
