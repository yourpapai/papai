// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { OpenPanelTrackRequest } from './mapping.js'
import type { DeliveryResult } from './transport-types.js'

export interface OpenPanelTransportOptions {
  readonly baseUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly fetchImpl: FetchImplementation
  readonly simulateAmbiguousSuccesses?: number
  readonly timeoutMs?: number
}

export interface OpenPanelTransport {
  readonly send: (request: OpenPanelTrackRequest) => Promise<DeliveryResult>
}

export type TransportBuildError =
  | 'ENDPOINT_NOT_LOOPBACK'
  | 'INVALID_BASE_URL'
  | 'INVALID_TIMEOUT'
  | 'MISSING_CREDENTIAL'
  | 'URL_CREDENTIALS_FORBIDDEN'

export type TransportBuildResult =
  | Readonly<{ ok: true; send: OpenPanelTransport['send'] }>
  | Readonly<{ code: TransportBuildError; ok: false }>

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type EndpointResult = Readonly<{ ok: true; endpoint: URL }> | Readonly<{ code: TransportBuildError; ok: false }>

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', '::1'])
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429])

function parseEndpoint(baseUrl: string): EndpointResult {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return { code: 'INVALID_BASE_URL', ok: false }
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { code: 'URL_CREDENTIALS_FORBIDDEN', ok: false }
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    return { code: 'ENDPOINT_NOT_LOOPBACK', ok: false }
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) return { code: 'INVALID_BASE_URL', ok: false }
  return { endpoint: new URL('/api/track', parsed), ok: true }
}

function classifyResponse(response: Response): DeliveryResult {
  if (response.status === 200 || response.status === 202) {
    return { kind: 'delivered', status: response.status }
  }
  if (response.ok) return { errorClass: 'ambiguous_ack', kind: 'ambiguous' }
  if (RETRYABLE_STATUSES.has(response.status) || response.status >= 500) {
    return { errorClass: 'http_retryable', kind: 'retryable', status: response.status }
  }
  return { errorClass: 'http_permanent', kind: 'permanent', status: response.status }
}

function sendRequest(
  endpoint: URL,
  options: OpenPanelTransportOptions,
  request: OpenPanelTrackRequest,
): Promise<DeliveryResult> {
  return options
    .fetchImpl(endpoint, {
      body: JSON.stringify(request),
      headers: {
        'content-type': 'application/json',
        'openpanel-client-id': options.clientId,
        'openpanel-client-secret': options.clientSecret,
      },
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    .then(classifyResponse)
    .catch(() => ({ errorClass: 'network_unknown', kind: 'ambiguous' }))
}

function simulatedSender(endpoint: URL, options: OpenPanelTransportOptions): OpenPanelTransport['send'] {
  let remainingAmbiguousSuccesses = options.simulateAmbiguousSuccesses ?? 0
  return async (request) => {
    const result = await sendRequest(endpoint, options, request)
    if (result.kind === 'delivered' && remainingAmbiguousSuccesses > 0) {
      remainingAmbiguousSuccesses -= 1
      return { errorClass: 'ambiguous_ack', kind: 'ambiguous' }
    }
    return result
  }
}

export function createOpenPanelTransport(options: OpenPanelTransportOptions): TransportBuildResult {
  if (options.clientId.length === 0 || options.clientSecret.length === 0) {
    return { code: 'MISSING_CREDENTIAL', ok: false }
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)
  ) {
    return { code: 'INVALID_TIMEOUT', ok: false }
  }
  const parsed = parseEndpoint(options.baseUrl)
  if (!parsed.ok) return parsed
  if (
    options.simulateAmbiguousSuccesses !== undefined &&
    (!Number.isSafeInteger(options.simulateAmbiguousSuccesses) || options.simulateAmbiguousSuccesses < 0)
  ) {
    return { code: 'INVALID_BASE_URL', ok: false }
  }
  return { ok: true, send: simulatedSender(parsed.endpoint, options) }
}
