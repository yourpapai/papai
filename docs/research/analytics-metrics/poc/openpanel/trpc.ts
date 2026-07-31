// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface TrpcClientOptions {
  readonly baseUrl: string
  readonly fetchImpl: FetchImplementation
  readonly sessionCookie: string
  readonly timeoutMs: number
}

export interface TrpcClient {
  readonly query: (procedure: string, input: unknown) => Promise<unknown>
  readonly mutate: (procedure: string, input: unknown) => Promise<unknown>
}

export type TrpcBuildResult =
  | Readonly<{ client: TrpcClient; ok: true }>
  | Readonly<{
      code: 'ENDPOINT_NOT_LOOPBACK' | 'INVALID_BASE_URL' | 'INVALID_COOKIE' | 'INVALID_TIMEOUT'
      ok: false
    }>

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', '::1'])
const PROCEDURE_PATTERN = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/u

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseBaseUrl(baseUrl: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return null
  }
  const safe =
    parsed.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(parsed.hostname) &&
    parsed.username.length === 0 &&
    parsed.password.length === 0 &&
    parsed.search.length === 0 &&
    parsed.hash.length === 0
  return safe ? parsed : null
}

function unwrapTrpc(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('TRPC_RESPONSE_INVALID')
  const result = value['result']
  if (!isRecord(result)) throw new Error('TRPC_RESPONSE_INVALID')
  const data = result['data']
  if (!isRecord(data) || !Object.hasOwn(data, 'json')) throw new Error('TRPC_RESPONSE_INVALID')
  return data['json']
}

function endpoint(baseUrl: URL, procedure: string): URL {
  if (!PROCEDURE_PATTERN.test(procedure)) throw new Error('TRPC_PROCEDURE_INVALID')
  return new URL(`/api/trpc/${procedure}`, baseUrl)
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`TRPC_HTTP_${response.status}`)
  const parsed: unknown = await response.json().catch(() => null)
  return unwrapTrpc(parsed)
}

function requestHeaders(sessionCookie: string, includeJson: boolean): HeadersInit {
  return {
    ...(includeJson ? { 'content-type': 'application/json' } : {}),
    cookie: `session=${sessionCookie}`,
  }
}

function buildClient(baseUrl: URL, options: TrpcClientOptions): TrpcClient {
  const request = (url: URL, init: RequestInit, procedure: string): Promise<unknown> =>
    options
      .fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      .then(parseResponse)
      .catch((error: unknown) => {
        const failure =
          error instanceof Error && error.message.startsWith('TRPC_')
            ? error.message.slice('TRPC_'.length)
            : 'NETWORK_OR_TIMEOUT'
        const label = procedure.replace('.', '_').toUpperCase()
        throw new Error(`TRPC_${label}_${failure}`)
      })
  return {
    mutate: (procedure, input) =>
      request(
        endpoint(baseUrl, procedure),
        {
          body: JSON.stringify({ json: input }),
          headers: requestHeaders(options.sessionCookie, true),
          method: 'POST',
        },
        procedure,
      ),
    query: (procedure, input) => {
      const url = endpoint(baseUrl, procedure)
      url.searchParams.set('input', JSON.stringify({ json: input }))
      return request(url, { headers: requestHeaders(options.sessionCookie, false), method: 'GET' }, procedure)
    },
  }
}

export function createTrpcClient(options: TrpcClientOptions): TrpcBuildResult {
  const parsed = parseBaseUrl(options.baseUrl)
  if (parsed === null) {
    try {
      const candidate = new URL(options.baseUrl)
      return LOOPBACK_HOSTS.has(candidate.hostname)
        ? { code: 'INVALID_BASE_URL', ok: false }
        : { code: 'ENDPOINT_NOT_LOOPBACK', ok: false }
    } catch {
      return { code: 'INVALID_BASE_URL', ok: false }
    }
  }
  if (
    options.sessionCookie.length === 0 ||
    options.sessionCookie.length > 4_096 ||
    /[\r\n;]/u.test(options.sessionCookie)
  ) {
    return { code: 'INVALID_COOKIE', ok: false }
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000) {
    return { code: 'INVALID_TIMEOUT', ok: false }
  }
  return { client: buildClient(parsed, options), ok: true }
}
