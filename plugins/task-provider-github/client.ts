// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  classifyProviderError,
  classifyStatusClass,
  createProviderRequestClock,
} from '../../src/analytics/provider-observer.js'
import type { ProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import { requireProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import { logger } from '../../src/logger.js'
import { GITHUB_DEFAULT_BASE_URL } from './constants.js'

const log = logger.child({ scope: 'github:client' })

export type GitHubConfig = {
  baseUrl: string
  repo: string
  token: string
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
  if (scope.kind !== 'actor') return
  const classification =
    caught === null
      ? { statusClass: classifyStatusClass(status ?? 200), retryable: null }
      : classifyProviderError(caught)
  try {
    scope.observeProviderRequest(scope.requestContext, {
      // The analytics provider dimension is a closed, versioned enum
      // (kaneo|youtrack|magi|mcp|llm|other); GitHub rides the catch-all bucket
      // until the catalog gains a github value through the review process.
      provider: 'other',
      operation,
      durationMs: clock.elapsedMs(),
      outcome: caught === null ? 'success' : 'failure',
      statusClass: classification.statusClass,
      retryable: classification.retryable,
    })
  } catch {
    // Observation must never change provider behavior.
  }
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly headers: Headers,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

export const readErrorBody = async (response: Response): Promise<unknown> => {
  // Read the stream once: a failed response.json() disturbs the body, so a
  // json-then-text fallback can never see the bytes.
  const text = await response.text().catch(() => null)
  if (text === null || text.length === 0) return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const executeObservedRequest = async (
  scope: ProviderRequestScope,
  clock: Readonly<{ elapsedMs: () => number }>,
  operation: BoundaryOperation,
  label: string,
  send: () => Promise<Response>,
): Promise<unknown> => {
  let caught: unknown = null
  let status: number | null = null
  try {
    const response = await send()
    status = response.status
    if (!response.ok) {
      const errorBody = await readErrorBody(response)
      log.error({ statusCode: response.status }, `GitHub ${label} failed`)
      throw new GitHubApiError(
        `GitHub API ${label} failed with status ${response.status}`,
        response.status,
        response.headers,
        errorBody,
      )
    }
    if (response.status === 204) return undefined
    const data: unknown = await response.json()
    log.debug({ statusCode: response.status }, `GitHub ${label} response received`)
    return data
  } catch (error) {
    caught = error
    throw error
  } finally {
    observeBoundary(scope, clock, operation, caught, status)
  }
}

/**
 * Resolves the API base: empty means the public default; trailing slashes are
 * stripped so path joining never doubles them (GHES subpath prefixes survive).
 */
export const resolveApiBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim()
  const value = trimmed.length === 0 ? GITHUB_DEFAULT_BASE_URL : trimmed
  return value.replace(/\/+$/u, '')
}

/**
 * Rate-limit shape detection: GitHub overloads 403 for both authorization
 * failure and rate limiting, so headers take precedence over the status code.
 * 429, `Retry-After`, or `x-ratelimit-remaining: 0` mark the error
 * rate-limited; a plain 403 does not (it is an auth failure). GitHub sends the
 * `x-ratelimit-*` trio on essentially every response, so the mere presence of
 * `x-ratelimit-reset` is not a rate-limit signal.
 */
export const isRateLimitedError = (error: unknown): boolean => {
  if (!(error instanceof GitHubApiError)) return false
  if (error.statusCode === 429) return true
  if (error.headers.has('retry-after')) return true
  return error.headers.get('x-ratelimit-remaining') === '0'
}

/**
 * Aggregates a paginated GitHub list endpoint: increments `page` at the fixed
 * `per_page` size until a page comes back short or empty. `extractPage` parses
 * one page (callers validate with their Zod schema; search pages unwrap `items`).
 * Recursion, not a loop: each page decides whether the next one is fetched, so
 * the requests are inherently sequential.
 */
export function githubPaginate<T>(
  config: GitHubConfig,
  path: string,
  options: {
    perPage?: number
    query?: Record<string, string | number>
    extractPage: (data: unknown) => T[]
  },
): Promise<T[]> {
  const perPage = options.perPage ?? 100
  const collectPage = async (page: number, accumulated: T[]): Promise<T[]> => {
    const data = await githubFetch(config, 'GET', path, {
      query: { ...options.query, page, per_page: perPage },
    })
    const items = options.extractPage(data)
    const results = [...accumulated, ...items]
    if (items.length < perPage) return results
    return collectPage(page + 1, results)
  }
  return collectPage(1, [])
}

/** Low-level fetch wrapper for the GitHub REST API. */
export function githubFetch(
  config: GitHubConfig,
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, string | number> },
): Promise<unknown> {
  return Promise.resolve().then(() => {
    const scope = requireProviderRequestScope()
    const clock = createProviderRequestClock()
    const joinedPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${resolveApiBaseUrl(config.baseUrl)}${joinedPath}`)
    if (options?.query !== undefined) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, String(value))
      }
    }

    log.debug({ method, hasBody: options?.body !== undefined }, 'GitHub API request')

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    return executeObservedRequest(scope, clock, operationOf(method), `${method} request`, () =>
      fetch(url.toString(), {
        method,
        headers,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    )
  })
}
