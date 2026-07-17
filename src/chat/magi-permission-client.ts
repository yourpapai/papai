// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { getPluginAdminConfig } from '../plugins/store.js'

const log = logger.child({ scope: 'chat:magi-permission-client' })

export type MagiConfig = { baseUrl: string; token: string }
type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>
type Decision = 'allow' | 'deny'

export function readMagiConfigFromStore(): MagiConfig | null {
  const baseUrl = getPluginAdminConfig('acp', 'magi_base_url')
  const token = getPluginAdminConfig('acp', 'magi_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}

interface ResolveDeps {
  config?: MagiConfig | null
  httpFetch?: HttpFetch
}

export async function resolveMagiPermission(
  sessionId: string,
  toolCallId: string,
  decision: Decision,
  deps: ResolveDeps = {},
): Promise<boolean> {
  const cfg = deps.config === undefined ? readMagiConfigFromStore() : deps.config
  if (cfg === null) {
    log.warn({ sessionId }, 'magi not configured; cannot resolve permission')
    return false
  }
  const httpFetch = deps.httpFetch ?? ((url, init): Promise<Response> => globalThis.fetch(url, init))
  try {
    const res = await httpFetch(`${cfg.baseUrl}/sessions/${encodeURIComponent(sessionId)}/permission`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId, decision }),
    })
    if (!res.ok) {
      log.warn({ sessionId, toolCallId, status: res.status }, 'magi permission resolve non-2xx')
      return false
    }
    return true
  } catch (error) {
    log.warn(
      { sessionId, toolCallId, error: error instanceof Error ? error.message : String(error) },
      'magi permission resolve threw',
    )
    return false
  }
}
