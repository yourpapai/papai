// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  classifyProviderError,
  classifyStatusClass,
  createProviderRequestClock,
} from '../../src/analytics/provider-observer.js'
import { type ProviderRequestScope, requireProviderRequestScope } from '../../src/analytics/provider-request-scope.js'

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

type BoundaryOperation = 'read' | 'search' | 'create' | 'update' | 'delete' | 'connect' | 'stream' | 'other'

const operationOf = (method: string): BoundaryOperation => {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'read'
    case 'POST':
      return 'create'
    case 'PUT':
    case 'PATCH':
      return 'update'
    case 'DELETE':
      return 'delete'
    default:
      return 'other'
  }
}

/** Emits the controlled request observation; never throws, never carries request/response content. */
const observeBoundary = (
  scope: ProviderRequestScope,
  clock: Readonly<{ elapsedMs: () => number }>,
  operation: BoundaryOperation,
  caught: unknown,
  status: number | null,
): void => {
  if (scope.kind === 'actor') {
    observeActorBoundary(scope, clock, operation, caught, status)
  }
}

const observeActorBoundary = (
  scope: Extract<ProviderRequestScope, { kind: 'actor' }>,
  clock: Readonly<{ elapsedMs: () => number }>,
  operation: BoundaryOperation,
  caught: unknown,
  status: number | null,
): void => {
  const failed = caught !== null || (status !== null && (status < 200 || status >= 300))
  const classification =
    caught === null
      ? { statusClass: classifyStatusClass(status ?? 200), retryable: null }
      : classifyProviderError(caught)
  try {
    scope.observeProviderRequest(scope.requestContext, {
      provider: 'magi',
      operation,
      durationMs: clock.elapsedMs(),
      outcome: failed ? 'failure' : 'success',
      statusClass: classification.statusClass,
      retryable: classification.retryable,
    })
  } catch {
    // Observation must never change provider behavior.
  }
}

export async function callMagi(
  httpFetch: HttpFetch,
  cfg: MagiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const scope = requireProviderRequestScope()
  const clock = createProviderRequestClock()
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let caught: unknown = null
  let status: number | null = null
  try {
    const res = await httpFetch(`${cfg.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    status = res.status
    const text = await res.text()
    const data: unknown = text === '' ? null : JSON.parse(text)
    if (!res.ok) return { error: 'magi_error', status: res.status, body: data }
    return data
  } catch (error) {
    caught = error
    throw error
  } finally {
    observeBoundary(scope, clock, operationOf(method), caught, status)
  }
}
