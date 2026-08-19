// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { observeScopedUnconfiguredReply } from './analytics/feature-observer.js'
import type { ProviderRequestScope } from './analytics/provider-request-scope.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ReplyFn } from './chat/types.js'
import { t } from './i18n/index.js'
import { checkRequiredProviderConfig } from './llm-orchestrator-config.js'
import { resolveLlmConfig } from './llm-providers/resolver.js'
import { getAdminRoleBindings } from './llm-providers/store.js'
import type { EffectiveLlmConfig, LlmConfigResult } from './llm-providers/types.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator' })

/**
 * Controlled fallback for missing required provider-context config keys.
 * Replies first; `unconfigured_reply` (provider_credentials) is emitted only
 * after the reply succeeds — never with the key list or reply text.
 */
export const ensureRequiredConfig = async (
  reply: ReplyFn,
  contextId: string,
  configId: string,
  scope: ProviderRequestScope,
): Promise<void> => {
  const missing = checkRequiredProviderConfig(configId)
  if (missing.length === 0) return
  log.warn({ contextId, configId, missing }, 'Missing required provider config keys')
  await reply.text(t('orchestrator.missingConfig', getContextLanguage(configId), { missing: missing.join(', ') }))
  observeScopedUnconfiguredReply(scope, { missing: 'provider_credentials', surface: 'chat' })
  throw new Error('Missing configuration')
}

let botMisconfiguredNotified = false

/** Test-only helper to reset the admin-notified guard between tests. */
export const resetBotMisconfiguredNotifiedForTesting = (): void => {
  botMisconfiguredNotified = false
}

const replyBotMisconfigured = async (reply: ReplyFn, contextId: string, scope: ProviderRequestScope): Promise<void> => {
  const configured = getAdminRoleBindings() !== null
  log.error({ contextId, configured }, 'admin LLM provider registry is incomplete; bot cannot serve this turn')
  await reply.text(
    t('orchestrator.botMisconfigured', getContextLanguage(getConfigContextIdFromStorageContextId(contextId))),
  )
  observeScopedUnconfiguredReply(scope, { missing: 'central_llm', surface: 'chat' })
  if (!botMisconfiguredNotified) {
    botMisconfiguredNotified = true
    log.warn({ configured }, 'admin notification suppressed for subsequent turns in this process')
  }
}

type LlmConfigFailure = Exclude<LlmConfigResult, EffectiveLlmConfig>
export type ResolvedTurnLlmConfig = EffectiveLlmConfig | null

async function replyByokConfigProblem(
  reply: ReplyFn,
  contextId: string,
  result: LlmConfigFailure,
  scope: ProviderRequestScope,
): Promise<void> {
  if (result.type === 'missing') {
    log.warn({ contextId, missing: result.missing }, 'BYOK LLM config is incomplete; bot cannot serve this turn')
    await reply.text(
      t('orchestrator.byokIncomplete', getContextLanguage(getConfigContextIdFromStorageContextId(contextId)), {
        missing: result.missing.join(', '),
      }),
    )
    observeScopedUnconfiguredReply(scope, { missing: 'provider_credentials', surface: 'chat' })
    return
  }
  log.warn({ contextId }, 'BYOK LLM config is unreadable; bot cannot serve this turn')
  await reply.text(
    t('orchestrator.byokUnreadable', getContextLanguage(getConfigContextIdFromStorageContextId(contextId))),
  )
  observeScopedUnconfiguredReply(scope, { missing: 'provider_credentials', surface: 'chat' })
}

export async function resolveLlmForTurn(
  reply: ReplyFn,
  contextId: string,
  configId: string,
  scope: ProviderRequestScope,
): Promise<ResolvedTurnLlmConfig> {
  const resolvedLlm = resolveLlmConfig(configId)
  if (resolvedLlm.ok) return resolvedLlm
  if (resolvedLlm.source === 'global') {
    await replyBotMisconfigured(reply, contextId, scope)
    return null
  }
  await replyByokConfigProblem(reply, contextId, resolvedLlm, scope)
  return null
}
import { getContextLanguage } from './utils/config-language.js'
