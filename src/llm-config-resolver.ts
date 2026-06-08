// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getByokCredentialState, getByokLlmConfig } from './byok-llm/store.js'
import type { RequiredByokLlmKey } from './byok-llm/types.js'
import { getSystemConfig, type SystemConfigKey } from './system-config.js'

export type EffectiveLlmConfig = {
  readonly ok: true
  readonly source: 'global' | 'byok'
  readonly llmApiKey: string
  readonly llmBaseUrl: string
  readonly mainModel: string
  readonly smallModel: string
  readonly embeddingModel: string
}

export type LlmConfigMissing = {
  readonly ok: false
  readonly type: 'missing'
  readonly source: 'global' | 'byok'
  readonly missing: readonly (SystemConfigKey | RequiredByokLlmKey)[]
}

export type LlmConfigError = {
  readonly ok: false
  readonly type: 'error'
  readonly source: 'global' | 'byok'
  readonly error: string
}

export type EffectiveLlmConfigResult = EffectiveLlmConfig | LlmConfigMissing | LlmConfigError

const REQUIRED_GLOBAL_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model'] as const satisfies readonly SystemConfigKey[]

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const resolveGlobalConfig = (): EffectiveLlmConfigResult => {
  const missing = REQUIRED_GLOBAL_KEYS.filter((key) => getSystemConfig(key) === null)
  if (missing.length > 0) return { ok: false, type: 'missing', source: 'global', missing }

  const mainModel = getSystemConfig('main_model') ?? ''
  return {
    ok: true,
    source: 'global',
    llmApiKey: getSystemConfig('llm_apikey') ?? '',
    llmBaseUrl: getSystemConfig('llm_baseurl') ?? '',
    mainModel,
    smallModel: getSystemConfig('small_model') ?? mainModel,
    embeddingModel: getSystemConfig('embedding_model') ?? mainModel,
  }
}

export function resolveEffectiveLlmConfig(configContextId: string): EffectiveLlmConfigResult {
  try {
    const state = getByokCredentialState(configContextId)
    if (!state.enabled) return resolveGlobalConfig()
    if (state.unreadable === true) {
      return {
        ok: false,
        type: 'error',
        source: 'byok',
        error: state.error ?? 'stored BYOK LLM credentials are unreadable',
      }
    }
    if (!state.complete) return { ok: false, type: 'missing', source: 'byok', missing: state.missing }

    const config = getByokLlmConfig(configContextId)
    if (config === null) return { ok: false, type: 'missing', source: 'byok', missing: state.missing }

    const mainModel = config.main_model ?? ''
    return {
      ok: true,
      source: 'byok',
      llmApiKey: config.llm_apikey ?? '',
      llmBaseUrl: config.llm_baseurl ?? '',
      mainModel,
      smallModel: config.small_model ?? mainModel,
      embeddingModel: config.embedding_model ?? mainModel,
    }
  } catch (error) {
    return { ok: false, type: 'error', source: 'byok', error: errorMessage(error) }
  }
}
