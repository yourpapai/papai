// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getPluginAdminConfig } from '../../plugins/store.js'

export type NervAdminResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; reason: 'not_configured' | 'unreachable' }

const TIMEOUT_MS = 5000

/**
 * Call nerv's HTTP API using the nerv plugin's admin-scoped config (nerv_base_url/nerv_token).
 * Never throws: a missing config resolves to not_configured, a network error to unreachable.
 * Mirrors readNervConfig's baseUrl trim in plugins/nerv/client.ts (core can't import the plugin).
 */
export async function nervAdminFetch(method: string, path: string, body?: unknown): Promise<NervAdminResult> {
  const baseUrl = getPluginAdminConfig('nerv', 'nerv_base_url')
  const token = getPluginAdminConfig('nerv', 'nerv_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') {
    return { ok: false, reason: 'not_configured' }
  }
  const url = `${baseUrl.trim().replace(/\/+$/u, '')}${path}`
  const headers: Record<string, string> = { Authorization: `Bearer ${token.trim()}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    return { ok: true, status: res.status, data: text === '' ? null : JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
