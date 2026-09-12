// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import type { StatusClass } from './controlled-types.js'
import type { AnalyticsObserver } from './runtime.js'
import type { AnalyticsSourceContext, ProviderRequestCompletedFact } from './source-facts.js'

/**
 * Explicit per-call analytics identity handed across provider/MCP/magi request
 * boundaries. Long-lived clients never read a mutable global identity; they
 * receive this context (or read the active request scope) at call time.
 */
export type AnalyticsRequestContext = Readonly<{
  source: AnalyticsSourceContext
  sourceEventId: string
}>

export type ProviderRequestObservation = Readonly<{
  provider: 'kaneo' | 'youtrack' | 'magi' | 'mcp' | 'llm' | 'github' | 'other'
  operation: 'read' | 'search' | 'create' | 'update' | 'delete' | 'connect' | 'stream' | 'other'
  durationMs: number
  outcome: 'success' | 'failure'
  statusClass: StatusClass
  retryable: boolean | null
}>

export type ObserveProviderRequest = (
  requestContext: AnalyticsRequestContext,
  observation: ProviderRequestObservation,
) => void

/** Maps an HTTP status code onto the bounded status-class enum. */
export const classifyStatusClass = (status: number): StatusClass => {
  if (status === 401 || status === 403) return 'auth'
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 400 && status < 500) return '4xx'
  if (status >= 500 && status < 600) return '5xx'
  return 'other'
}

const TIMEOUT_ERROR_NAMES: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError'])
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
])

const numericStatusOf = (error: object): number | null => {
  const candidate: unknown = Reflect.get(error, 'statusCode') ?? Reflect.get(error, 'status')
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

const stringCodeOf = (error: object): string | null => {
  const candidate: unknown = Reflect.get(error, 'code')
  return typeof candidate === 'string' ? candidate : null
}

/**
 * Pure error classifier for provider request boundaries. Returns only the
 * controlled status class and retryability — never any message, URL, body, or
 * token carried by the upstream error. Safe on non-`Error` throws.
 */
export const classifyProviderError = (
  error: unknown,
): Readonly<{ statusClass: StatusClass; retryable: boolean | null }> => {
  if (error instanceof Error) {
    if (TIMEOUT_ERROR_NAMES.has(error.name)) return { statusClass: 'timeout', retryable: true }
    const status = numericStatusOf(error)
    if (status !== null) {
      const statusClass = classifyStatusClass(status)
      return { statusClass, retryable: status === 429 || status >= 500 }
    }
    const code = stringCodeOf(error)
    if (code === 'ETIMEDOUT') return { statusClass: 'timeout', retryable: true }
    if (code !== null && NETWORK_ERROR_CODES.has(code)) return { statusClass: 'network', retryable: true }
    if (error instanceof TypeError && error.message === 'fetch failed') {
      return { statusClass: 'network', retryable: true }
    }
    return { statusClass: 'other', retryable: null }
  }
  return { statusClass: 'other', retryable: null }
}

/**
 * Monotonic duration helper for request boundaries. Uses `performance.now` by
 * default so wall-clock adjustments cannot skew or negate durations.
 */
export const createProviderRequestClock = (
  nowMonotonicMs: () => number = () => performance.now(),
): Readonly<{ elapsedMs: () => number }> => {
  const startedAt = nowMonotonicMs()
  return {
    elapsedMs: () => Math.max(0, nowMonotonicMs() - startedAt),
  }
}

const buildProviderRequestCompletedFact = (
  requestContext: AnalyticsRequestContext,
  observation: ProviderRequestObservation,
): ProviderRequestCompletedFact => ({
  version: 1,
  type: 'provider_request_completed',
  sourceEventId: `${requestContext.sourceEventId}:provider_request_completed:${randomUUID()}`,
  occurredAtMs: Date.now(),
  source: requestContext.source,
  provider: observation.provider,
  operation: observation.operation,
  durationMs: Math.max(0, Math.round(observation.durationMs)),
  outcome: observation.outcome,
  statusClass: observation.statusClass,
  retryable: observation.retryable,
})

/**
 * Binds an `AnalyticsObserver` into a metadata-only request-boundary callback.
 * The callback is stable and non-throwing: an observation failure must never
 * change provider behavior.
 */
export const createProviderRequestObserver = (observer: AnalyticsObserver): ObserveProviderRequest => {
  return (requestContext, observation) => {
    try {
      observer.observe(buildProviderRequestCompletedFact(requestContext, observation))
    } catch {
      // Observation must never change provider behavior.
    }
  }
}
