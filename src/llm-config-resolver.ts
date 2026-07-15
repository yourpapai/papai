// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveLlmConfig } from './llm-providers/resolver.js'
import { getAdminRoleBindings } from './llm-providers/store.js'
import type { LlmConfigResult } from './llm-providers/types.js'
import { getSystemConfig, type SystemConfigKey } from './system-config.js'

// Legacy single-cred shape, preserved during the call-site migration (Tasks 9-12).
export type EffectiveLlmConfig = {
  readonly ok: true
  readonly source: 'global' | 'byok'
  readonly llmApiKey: string
  readonly llmBaseUrl: string
  readonly mainModel: string
  readonly smallModel: string
  readonly embeddingModel: string
}

// `missing` is widened to `readonly string[]` so the adapter can forward the new
// resolver's `readonly string[]` result (e.g. `['main']`) without an unsafe cast.
// Every consumer only `.join(', ')`s this field, so the literal union is unused.
export type LlmConfigMissing = {
  readonly ok: false
  readonly type: 'missing'
  readonly source: 'global' | 'byok'
  readonly missing: readonly string[]
}

export type LlmConfigError = {
  readonly ok: false
  readonly type: 'error'
  readonly source: 'global' | 'byok'
  readonly error: string
}

export type EffectiveLlmConfigResult = EffectiveLlmConfig | LlmConfigMissing | LlmConfigError

const REQUIRED_GLOBAL_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model'] as const satisfies readonly SystemConfigKey[]

// Transitional: used only until env-bootstrap seeds the new tables (Task 17).
export const resolveGlobalConfig = (): EffectiveLlmConfigResult => {
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

const fromResult = (r: LlmConfigResult): EffectiveLlmConfigResult => {
  if (r.ok) {
    return {
      ok: true,
      source: r.main.source,
      llmApiKey: r.main.apiKey,
      llmBaseUrl: r.main.baseUrl,
      mainModel: r.main.model,
      smallModel: r.small.model,
      embeddingModel: r.embedding.model,
    }
  }
  if (r.type === 'error') return { ok: false, type: 'error', source: 'byok', error: r.error }
  return { ok: false, type: 'missing', source: r.source, missing: r.missing }
}

export function resolveEffectiveLlmConfig(configContextId: string): EffectiveLlmConfigResult {
  // The new registry is authoritative once it has an admin role binding; otherwise
  // fall back to the legacy system_config path (fresh deploy before Task 17).
  if (getAdminRoleBindings() === null) return resolveGlobalConfig()
  return fromResult(resolveLlmConfig(configContextId))
}
