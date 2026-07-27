// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'

import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ApprovedEndpoint } from './http-policy.js'
import type { DeliveryErrorClass } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:pinned-transport' })

export const EGRESS_MAX_BODY_BYTES = 256 * 1024
export const EGRESS_MAX_RESPONSE_BYTES = 64 * 1024
export const EGRESS_DEFAULT_TIMEOUT_MS = 10_000
export const EGRESS_DEFAULT_CONCURRENCY = 2

export type PinnedSendOutcome =
  | Readonly<{ kind: 'delivered'; status: number; receiptHash: string }>
  | Readonly<{ kind: 'responded'; status: number; errorClass: DeliveryErrorClass }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'network'; acknowledgement: 'none' | 'uncertain' }>
  | Readonly<{ kind: 'policy'; reason: 'body_too_large' | 'endpoint_mismatch' }>

export type PinnedRequestInput = Readonly<{
  headers: Readonly<Record<string, string>>
  body: string
  timeoutMs?: number
  expectedUrl?: string
}>

export type PinnedTransport = (endpoint: ApprovedEndpoint, input: PinnedRequestInput) => Promise<PinnedSendOutcome>

export type PinnedTransportDeps = Readonly<{
  request?: PolicyRequestFn
  maxBodyBytes?: number
}>

export type PolicyResponse = {
  readonly statusCode?: number | undefined
  on: (event: 'data' | 'end' | 'error', listener: (chunk: unknown) => void) => unknown
}

export type PolicyRequest = {
  on: (event: 'finish' | 'response' | 'timeout' | 'error', listener: (response: PolicyResponse) => void) => unknown
  end: (body?: string) => void
  destroy: () => void
}

export type PolicyRequestOptions = Readonly<{
  protocol: string
  host: string
  port: number
  path: string
  method: string
  servername: string
  headers: Record<string, string>
  lookup: LookupFunction
  timeout: number
  rejectUnauthorized: boolean
}>

export type PolicyRequestFn = (options: PolicyRequestOptions) => PolicyRequest

const nodeRequest: PolicyRequestFn = (options) => httpsRequest(options)

const statusErrorClass = (status: number): DeliveryErrorClass => {
  if (status >= 300 && status < 400) return 'policy'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 400 && status < 500) return 'http_4xx'
  if (status >= 500 && status < 600) return 'http_5xx'
  return 'unknown'
}

const buildRequestOptions = (endpoint: ApprovedEndpoint, input: PinnedRequestInput): PolicyRequestOptions => ({
  protocol: 'https:',
  host: endpoint.pinnedAddress.address,
  port: endpoint.port,
  path: endpoint.path,
  method: 'POST',
  servername: endpoint.hostname,
  headers: {
    host: endpoint.hostname,
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(input.body, 'utf8')),
    ...input.headers,
  },
  lookup: (_hostname, _options, callback): void => {
    callback(null, endpoint.pinnedAddress.address, endpoint.pinnedAddress.family)
  },
  timeout: input.timeoutMs ?? EGRESS_DEFAULT_TIMEOUT_MS,
  rejectUnauthorized: true,
})

const collectResponse = (response: PolicyResponse, finish: (outcome: PinnedSendOutcome) => void): void => {
  const status = response.statusCode ?? 0
  const chunks: Buffer[] = []
  let size = 0
  response.on('data', (chunk: unknown) => {
    if (!Buffer.isBuffer(chunk)) return
    if (size >= EGRESS_MAX_RESPONSE_BYTES) return
    chunks.push(chunk)
    size += chunk.length
  })
  response.on('end', () => {
    if (status >= 200 && status < 300) {
      const receiptHash = createHash('sha256').update(Buffer.concat(chunks)).digest('hex')
      finish({ kind: 'delivered', status, receiptHash })
      return
    }
    finish({ kind: 'responded', status, errorClass: statusErrorClass(status) })
  })
  response.on('error', () => {
    finish({ kind: 'network', acknowledgement: 'uncertain' })
  })
}

const sendPinned = (
  requestFn: PolicyRequestFn,
  endpoint: ApprovedEndpoint,
  input: PinnedRequestInput,
): Promise<PinnedSendOutcome> =>
  new Promise<PinnedSendOutcome>((resolve) => {
    let settled = false
    let flushed = false
    const finish = (outcome: PinnedSendOutcome): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    const request = requestFn(buildRequestOptions(endpoint, input))
    request.on('finish', () => {
      flushed = true
    })
    request.on('response', (response) => {
      collectResponse(response, finish)
    })
    request.on('timeout', () => {
      request.destroy()
      finish({ kind: 'timeout' })
    })
    request.on('error', () => {
      finish({ kind: 'network', acknowledgement: flushed ? 'uncertain' : 'none' })
    })
    request.end(input.body)
  })

export const createPinnedTransport = (deps: PinnedTransportDeps = {}): PinnedTransport => {
  const requestFn = deps.request ?? nodeRequest
  const maxBodyBytes = deps.maxBodyBytes ?? EGRESS_MAX_BODY_BYTES
  return (endpoint, input) => {
    if (input.expectedUrl !== undefined && input.expectedUrl !== endpoint.url) {
      log.warn('egress refused: request URL does not match the approved sink record')
      return Promise.resolve({ kind: 'policy', reason: 'endpoint_mismatch' })
    }
    if (Buffer.byteLength(input.body, 'utf8') > maxBodyBytes) {
      log.warn('egress refused: request body exceeds the policy cap')
      return Promise.resolve({ kind: 'policy', reason: 'body_too_large' })
    }
    return sendPinned(requestFn, endpoint, input)
  }
}

export const createEgressLimiter = (concurrency: number = EGRESS_DEFAULT_CONCURRENCY): ReturnType<typeof pLimit> =>
  pLimit(concurrency)
