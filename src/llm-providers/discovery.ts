// src/llm-providers/discovery.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { fetchWithoutTimeout } from '../utils/fetch.js'
import type { VerificationStatus } from './types.js'

const log = logger.child({ scope: 'llm-providers:discovery' })

export type DiscoveryResult = {
  readonly status: VerificationStatus
  readonly models: readonly string[]
  readonly error: string | null
}

export interface DiscoveryDeps {
  readonly fetch: typeof fetchWithoutTimeout
}

const defaultDeps: DiscoveryDeps = { fetch: fetchWithoutTimeout }

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type OpenAiModel = { readonly id?: unknown }
type OpenAiModelList = { readonly data?: ReadonlyArray<OpenAiModel> }

const isModelList = (value: unknown): value is OpenAiModelList =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const extractModels = (json: unknown): readonly string[] => {
  if (!isModelList(json)) return []
  const data = json.data ?? []
  return data.flatMap((m): string[] => (typeof m.id === 'string' ? [m.id] : []))
}

export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
  deps: DiscoveryDeps = defaultDeps,
): Promise<DiscoveryResult> {
  const url = `${baseUrl.replace(/\/$/u, '')}/models`
  try {
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (res.status === 401 || res.status === 403) {
      return { status: 'unverified', models: [], error: 'authentication failed' }
    }
    if (!res.ok) {
      return { status: 'error', models: [], error: `unexpected status ${res.status}` }
    }
    const json: unknown = await res.json()
    const models = extractModels(json)
    return { status: 'verified', models, error: null }
  } catch (e) {
    log.warn({ url, error: errMsg(e) }, 'provider model discovery failed')
    return { status: 'error', models: [], error: errMsg(e) }
  }
}
