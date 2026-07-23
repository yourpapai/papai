// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { AiProgressReporter } from './ai-progress-reporter.js'
import type { ReplyFn } from './chat/types.js'
import { buildVerifiedCompletion, detectToolFailure } from './completion/verified-completion.js'
import type { VerifierDeps } from './completion/verified-completion.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator:send' })

type SendResult = {
  text: string | undefined
  finishReason?: string
  toolCalls: unknown[] | undefined
  finalStep: { response: { messages: ModelMessage[] } }
}
type Verification = { verifier: VerifierDeps; history: readonly ModelMessage[] }

/** Resolve the text to post: a verifier round-trip for risky turns, else the model text (or "Done."). */
const resolveFinalText = async (
  result: SendResult,
  hadToolFailure: boolean,
  verification: Verification | undefined,
): Promise<string> => {
  const isRisky =
    result.text === undefined || result.text === '' || result.finishReason === 'tool-calls' || hadToolFailure
  if (isRisky && verification !== undefined) {
    const verified = await buildVerifiedCompletion(
      { history: verification.history, finishReason: result.finishReason, hadToolFailure },
      verification.verifier,
    )
    return verified.text
  }
  return result.text !== undefined && result.text !== '' ? result.text : 'Done.'
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
  const hadToolFailure = detectToolFailure(result.finalStep.response.messages)
  const textToFormat = await resolveFinalText(result, hadToolFailure, verification)

  const responseLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  const meta = { contextId, responseLength, toolCalls: toolCallCount, finishReason: result.finishReason }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'LLM turn ended on a pending tool call (step cap reached); reply may be incomplete')
  }
  if (beforeFirstMessage !== undefined) await beforeFirstMessage()
  await reply.formatted(textToFormat)
  await flushProgressDetails(progressReporter, contextId)
  log.info(meta, 'Response sent successfully')
}
