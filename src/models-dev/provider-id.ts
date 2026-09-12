// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ProviderIdInput = {
  readonly providerType?: string | null
  readonly baseUrl?: string | null
}

const PROVIDER_TYPE_IDS: Readonly<Record<string, string>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  openrouter: 'openrouter',
  groq: 'groq',
  ollama: 'ollama',
}

const BASE_URL_HOST_IDS: Readonly<Record<string, string>> = {
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'openrouter.ai': 'openrouter',
  'api.groq.com': 'groq',
}

const isDeclared = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value !== ''

const hostOf = (baseUrl: string): string | null => {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === '' ? null : host
  } catch {
    return null
  }
}

export function inferProviderId(input: ProviderIdInput): string | null {
  if (isDeclared(input.providerType)) {
    const typed = PROVIDER_TYPE_IDS[input.providerType]
    if (typed !== undefined) return typed
  }
  if (isDeclared(input.baseUrl)) {
    const host = hostOf(input.baseUrl)
    if (host !== null) {
      const mapped = BASE_URL_HOST_IDS[host]
      if (mapped !== undefined) return mapped
    }
  }
  return null
}
