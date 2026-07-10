// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>
export type AdminConfigReader = { get(key: string): string | undefined }
export type MagiConfig = { baseUrl: string; token: string }

export const NOT_CONFIGURED = { error: 'not_configured', message: 'magi base URL or token is not configured' } as const

export function readMagiConfig(adminConfig: AdminConfigReader): MagiConfig | null {
  const baseUrl = adminConfig.get('magi_base_url')
  const token = adminConfig.get('magi_token')
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

export function asPositiveInt(input: Record<string, unknown>, key: string): number | null {
  const v = input[key]
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

export async function callMagi(
  httpFetch: HttpFetch,
  cfg: MagiConfig,
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
  if (!res.ok) return { error: 'magi_error', status: res.status, body: data }
  return data
}
