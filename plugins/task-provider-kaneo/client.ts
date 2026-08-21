// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ZodType } from 'zod'

import {
  classifyProviderError,
  classifyStatusClass,
  createProviderRequestClock,
} from '../../src/analytics/provider-observer.js'
import type { ProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import { requireProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import { logger } from '../../src/logger.js'
import { KaneoApiError, KaneoValidationError } from './errors.js'

const log = logger.child({ scope: 'kaneo:client' })

export type KaneoConfig = {
  apiKey: string
  baseUrl: string
} & Partial<{
  /** Session cookie value (better-auth.session_token=...). When set, sent instead of Authorization: Bearer. */
  sessionCookie: string
  /** Runtime-owned transport for hermetic plugin execution. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}>

export function isKaneoSessionCookie(value: string): boolean {
  if (value.startsWith('better-auth.session_token=')) {
    return true
  }

  return value.startsWith('__Secure-better-auth.session_token=')
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
      provider: 'kaneo',
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

function buildUrl(config: KaneoConfig, path: string, query: Record<string, string> | undefined): URL {
  const url = new URL(`${config.baseUrl}/api${path}`)
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }
  return url
}

async function fetchResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return response.text().catch(() => 'Unable to read response body')
  }
}

const RESOURCE_CLASS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\/task-relation/iu, 'task-relation'],
  [/\/label/iu, 'label'],
  [/\/(activity|comment)/iu, 'comment'],
  [/\/(project|column)/iu, 'project'],
  [/\/task/iu, 'task'],
]

/** Maps a request path onto a bounded resource class; the raw path never crosses the error/log boundary. */
export const resourceClassOf = (path: string): string => {
  for (const [pattern, resourceClass] of RESOURCE_CLASS_PATTERNS) {
    if (pattern.test(path)) return resourceClass
  }
  return 'other'
}

async function handleErrorResponse(response: Response, method: string, resourceClass: string): Promise<never> {
  const responseBody = await fetchResponseBody(response)
  log.error({ method, statusCode: response.status, resourceClass }, 'Kaneo API error')
  throw new KaneoApiError(
    `Kaneo API ${method} request failed with status ${response.status}`,
    response.status,
    responseBody,
    resourceClass,
  )
}

function validateResponse<T>(rawData: unknown, schema: ZodType<T>, method: string, statusCode: number): T {
  const result = schema.safeParse(rawData)
  if (!result.success) {
    log.error({ method, statusCode }, 'Kaneo API response validation failed')
    throw new KaneoValidationError(`Kaneo API ${method} request returned invalid data`, result.error)
  }
  log.debug({ method, statusCode }, 'Kaneo API response validated')
  return result.data
}

export async function kaneoFetch<T>(
  config: KaneoConfig,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> | undefined,
  schema: ZodType<T>,
): Promise<T> {
  const scope = requireProviderRequestScope()
  const clock = createProviderRequestClock()
  const url = buildUrl(config, path, query)

  log.debug({ method, hasBody: body !== undefined, hasQuery: query !== undefined }, 'Kaneo API request')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.sessionCookie === undefined) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  } else {
    headers['Cookie'] = config.sessionCookie
  }

  let caught: unknown = null
  let status: number | null = null
  try {
    const response = await (config.fetch ?? fetch)(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    status = response.status

    if (!response.ok) {
      return await handleErrorResponse(response, method, resourceClassOf(path))
    }

    const rawData: unknown = await response.json()

    return validateResponse(rawData, schema, method, response.status)
  } catch (error) {
    caught = error
    throw error
  } finally {
    observeBoundary(scope, clock, operationOf(method), caught, status)
  }
}
