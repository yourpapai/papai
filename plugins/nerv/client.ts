// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getActiveTaskId, setActive, type KvStore } from './history.js'

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>
export type AdminConfigReader = { get(key: string): string | undefined }
export type NervConfig = { baseUrl: string; token: string }

export const NOT_CONFIGURED = { error: 'not_configured', message: 'nerv base URL or token is not configured' } as const

export function readNervConfig(adminConfig: AdminConfigReader): NervConfig | null {
  const baseUrl = adminConfig.get('nerv_base_url')
  const token = adminConfig.get('nerv_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}

export function asObject(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input !== null) return Object.fromEntries(Object.entries(input))
  return {}
}

export function asString(input: Record<string, unknown>, key: string): string | null {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function asNumber(input: Record<string, unknown>, key: string): number | null {
  const v = input[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function callNerv(
  httpFetch: HttpFetch,
  cfg: NervConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await httpFetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data: unknown = text === '' ? null : JSON.parse(text)
  if (!res.ok) return { error: 'nerv_error', status: res.status, body: data }
  return data
}

/**
 * Resolve which nerv task a chat action targets:
 *   explicit taskId  →  kv "active" pointer  →  nerv lookup by (thread-scoped) context (cached).
 * The nerv fallback makes forge-adopted tasks — created inside nerv, never seen by create_coding_task
 * — resolvable from a chat follow-up in their thread.
 */
export async function resolveActiveTaskId(
  httpFetch: HttpFetch,
  cfg: NervConfig,
  kv: KvStore,
  storageContextId: string,
  explicitTaskId: string | null,
): Promise<string | null> {
  if (explicitTaskId !== null) return explicitTaskId
  const cached = getActiveTaskId(kv, storageContextId)
  if (cached !== null) return cached
  // Deliberate fail-safe: a throwing httpFetch (network failure/timeout) must not propagate out
  // of this resolver and crash the calling tool. Treat an unreachable nerv the same as "no
  // resolvable task" — the caller reports not_found — rather than surfacing a raw error. Do not
  // cache anything in this case.
  let result: unknown
  try {
    result = await callNerv(httpFetch, cfg, 'GET', `/tasks?contextId=${encodeURIComponent(storageContextId)}`)
  } catch {
    return null
  }
  const taskId = asString(asObject(result), 'taskId')
  if (taskId !== null) setActive(kv, storageContextId, taskId)
  return taskId
}
