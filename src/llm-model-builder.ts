// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import { fetchWithoutTimeout } from './utils/fetch.js'

export interface ModelBuilderDeps {
  create: typeof createOpenAICompatible
}

const defaultDeps: ModelBuilderDeps = { create: createOpenAICompatible }

// BYOK alternates credentials across turns; a single-entry cache would thrash.
const MAX_CACHED_PROVIDERS = 32
const providerCache = new Map<string, OpenAICompatibleProvider>()

export function clearModelBuilderCacheForTesting(): void {
  providerCache.clear()
}

export function getOpenAICompatibleProvider(
  apiKey: string,
  baseUrl: string,
  deps: ModelBuilderDeps = defaultDeps,
): OpenAICompatibleProvider {
  const key = `${apiKey}\0${baseUrl}`
  const cached = providerCache.get(key)
  if (cached !== undefined) return cached
  const provider = deps.create({ name: 'openai-compatible', apiKey, baseURL: baseUrl, fetch: fetchWithoutTimeout })
  if (providerCache.size >= MAX_CACHED_PROVIDERS) {
    const oldest = providerCache.keys().next().value
    if (oldest !== undefined) providerCache.delete(oldest)
  }
  providerCache.set(key, provider)
  return provider
}

export function buildChatModel(
  apiKey: string,
  baseUrl: string,
  modelName: string,
  deps: ModelBuilderDeps = defaultDeps,
): LanguageModel {
  return getOpenAICompatibleProvider(apiKey, baseUrl, deps)(modelName)
}
