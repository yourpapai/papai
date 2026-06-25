// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getCodingCredentials } from './store.js'

export function configContextOf(storageContextId: string): string {
  return getConfigContextIdFromStorageContextId(storageContextId)
}

/**
 * Resolve the acting context's agent-provider credentials and map them to the
 * env-name-keyed secrets the magi request expects. papai owns this mapping
 * (Phase 1: Anthropic only). Returns null when no complete credential exists.
 */
export function resolveAgentSecrets(storageContextId: string): Record<string, string> | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'agent-provider')
  const apiKey = creds?.provider_api_key?.trim()
  if (apiKey === undefined || apiKey.length === 0) return null
  const out: Record<string, string> = { ANTHROPIC_API_KEY: apiKey }
  const baseUrl = creds?.provider_base_url?.trim()
  if (baseUrl !== undefined && baseUrl.length > 0) out['ANTHROPIC_BASE_URL'] = baseUrl
  return out
}

/**
 * Resolve the acting context's forge (code-host) token.
 * Returns null when no token is stored.
 */
export function resolveForgeToken(storageContextId: string): string | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'forge')
  const token = creds?.forge_token?.trim()
  return token === undefined || token.length === 0 ? null : token
}
