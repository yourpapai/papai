// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { logger } from '../logger.js'
import type { ModelMetadata } from '../models-dev/resolve.js'

const log = logger.child({ scope: 'deferred:proactive-llm-config' })

export type LlmConfig = {
  apiKey: string
  baseURL: string
  mainModel: string
  metadata: ModelMetadata
}

export interface LlmConfigDeps {
  resolveLlmConfig: typeof resolveLlmConfig
}

const defaultLlmConfigDeps: LlmConfigDeps = { resolveLlmConfig }

export function getLlmConfig(configContextId: string, deps: LlmConfigDeps = defaultLlmConfigDeps): LlmConfig | string {
  const resolved = deps.resolveLlmConfig(configContextId)
  if (!resolved.ok) {
    log.warn(
      {
        configContextId,
        source: resolved.source,
        type: resolved.type,
        missing: resolved.type === 'missing' ? resolved.missing : undefined,
        error: resolved.type === 'error' ? resolved.error : undefined,
      },
      'Missing LLM config for deferred prompt',
    )
    if (resolved.source === 'global') {
      return 'I could not deliver a scheduled reminder or alert — the bot is not fully configured. The administrator has been notified.'
    }
    if (resolved.type === 'missing') {
      return 'I could not deliver a scheduled reminder or alert — BYOK is enabled for this context, but the required LLM settings are missing. Use /config to complete setup.'
    }
    return 'I could not deliver a scheduled reminder or alert — the BYOK credentials for this context are unreadable. Use /config to re-enter the BYOK LLM credentials in the settings web UI.'
  }
  return {
    apiKey: resolved.main.apiKey,
    baseURL: resolved.main.baseUrl,
    mainModel: resolved.main.model,
    metadata: resolved.main.metadata,
  }
}
