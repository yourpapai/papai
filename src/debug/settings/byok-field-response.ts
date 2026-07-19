// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getByokBundle, getByokCredentialState, getByokLlmConfig } from '../../byok-llm/store.js'
import type { ByokLlmKey } from '../../byok-llm/types.js'
import { maskSensitiveValue } from '../../config.js'
import type { LlmProviderAccount, LlmRoleBindings } from '../../llm-providers/types.js'

export const BYOK_FIELDS = [
  { key: 'llm_apikey', label: 'LLM API Key', required: true, sensitive: true },
  {
    key: 'llm_baseurl',
    label: 'LLM Base URL',
    required: true,
    sensitive: false,
  },
  { key: 'main_model', label: 'Main Model', required: true, sensitive: false },
  {
    key: 'small_model',
    label: 'Small Model',
    required: false,
    sensitive: false,
  },
  {
    key: 'embedding_model',
    label: 'Embedding Model',
    required: false,
    sensitive: false,
  },
] as const satisfies readonly {
  readonly key: ByokLlmKey
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
}[]

const maskApiKey = (apiKey: string): string => `****${apiKey.slice(-4)}`

const publicByokProvider = (p: LlmProviderAccount): unknown => ({
  id: p.id,
  label: p.label,
  providerType: p.providerType,
  baseUrl: p.baseUrl,
  apiKeyMasked: maskApiKey(p.apiKey),
  verification: p.verification,
})

const emptyRolesResponse = (): LlmRoleBindings => ({
  main: { providerId: '', model: '' },
  small: null,
  embedding: null,
})

export const buildByokFieldResponse = (contextId: string): unknown => {
  const state = getByokCredentialState(contextId)
  if (!state.enabled)
    return { enabled: false, complete: false, missing: [], fields: [], providers: [], roles: emptyRolesResponse() }

  const bundle = getByokBundle(contextId)
  if (bundle.unreadable)
    return {
      ...state,
      unreadable: true,
      error: bundle.error,
      fields: [],
      providers: [],
      roles: emptyRolesResponse(),
    }

  const config = getByokLlmConfig(contextId) ?? {}
  const fields = BYOK_FIELDS.map((field) => {
    const raw = config[field.key] ?? ''
    const hasValue = raw.length > 0
    return {
      ...field,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw,
    }
  })

  const providers = (bundle.blob?.providers ?? []).map(publicByokProvider)
  const roles = bundle.blob?.roles ?? emptyRolesResponse()

  return { ...state, fields, providers, roles }
}
