// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { assertPublicUrl } from '../web/safe-fetch.js'

export interface ModelOption {
  value: string
  label: string
}

const stripSlash = (u: string): string => u.replace(/\/+$/u, '')

function modelsRequest(
  provider: string,
  baseUrl: string | undefined,
  key: string,
): { url: string; headers: Record<string, string> } {
  const base = baseUrl?.trim()
  if (provider === 'anthropic') {
    const root = base !== undefined && base.length > 0 ? stripSlash(base) : 'https://api.anthropic.com'
    return { url: `${root}/v1/models`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
  }
  // openai + openai-compatible: OPENAI_BASE_URL convention already includes the version segment.
  const root = base !== undefined && base.length > 0 ? stripSlash(base) : 'https://api.openai.com/v1'
  return { url: `${root}/models`, headers: { authorization: `Bearer ${key}` } }
}

// opencode model ids are `provider/model`; claude/codex use bare ids. We only know
// the prefix for the well-known providers (custom openai-compatible → no prefix).
function opencodePrefix(provider: string): string | null {
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'openai') return 'openai'
  return null
}

const ModelsApiResponseSchema = z.object({ data: z.array(z.object({ id: z.string() }).loose()).default([]) }).loose()

function extractIds(body: unknown): string[] {
  const result = ModelsApiResponseSchema.safeParse(body)
  return result.success ? result.data.data.map((e) => e.id) : []
}

/**
 * Fetch the provider's model ids for the settings combobox. SSRF-guarded via
 * assertPublicUrl. For opencode, ids are prefixed with the provider where known.
 * Throws on network error / non-200 / blocked URL — the caller degrades to free-text.
 */
export async function fetchProviderModels(
  provider: string,
  baseUrl: string | undefined,
  key: string,
  agent: string,
): Promise<ModelOption[]> {
  const { url, headers } = modelsRequest(provider, baseUrl, key)
  await assertPublicUrl(new URL(url))
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`provider models request failed: ${res.status}`)
  const ids = extractIds(await res.json())
  const prefix = agent === 'opencode' ? opencodePrefix(provider) : null
  return ids.map((id) => {
    const v = prefix === null ? id : `${prefix}/${id}`
    return { value: v, label: v }
  })
}
