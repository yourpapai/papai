// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from './chat/types.js'
import { resolveLlmConfig } from './llm-providers/resolver.js'
import { getAdminRoleBindings } from './llm-providers/store.js'
import type { EffectiveLlmConfig, LlmConfigResult } from './llm-providers/types.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator' })

type LlmConfigFailure = Exclude<LlmConfigResult, EffectiveLlmConfig>
type ResolvedTurnLlmConfig = EffectiveLlmConfig | null

let botMisconfiguredNotified = false

const replyBotMisconfigured = async (reply: ReplyFn, contextId: string): Promise<void> => {
  const configured = getAdminRoleBindings() !== null
  log.error({ contextId, configured }, 'admin LLM provider registry is incomplete; bot cannot serve this turn')
  await reply.text(
    '⚠️ The bot is not fully configured. Ask the administrator to run /config and complete setup in the web UI.',
  )
  if (!botMisconfiguredNotified) {
    botMisconfiguredNotified = true
    log.warn({ configured }, 'admin notification suppressed for subsequent turns in this process')
  }
}

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

export async function resolveLlmForTurn(
  reply: ReplyFn,
  contextId: string,
  configId: string,
): Promise<ResolvedTurnLlmConfig> {
  const resolvedLlm = resolveLlmConfig(configId)
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
