// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ZodType } from 'zod'

import { logger } from '../../src/logger.js'
import { KaneoApiError, KaneoValidationError } from './errors.js'

const log = logger.child({ scope: 'kaneo:client' })

export type KaneoConfig = {
  apiKey: string
  baseUrl: string
} & Partial<{
  /** Session cookie value (better-auth.session_token=...). When set, sent instead of Authorization: Bearer. */
  sessionCookie: string
}>

export function isKaneoSessionCookie(value: string): boolean {
  if (value.startsWith('better-auth.session_token=')) {
    return true
  }

  return value.startsWith('__Secure-better-auth.session_token=')
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

async function handleErrorResponse(response: Response, method: string, path: string): Promise<never> {
  const responseBody = await fetchResponseBody(response)
  log.error({ method, path, statusCode: response.status, responseBody }, 'Kaneo API error')
  throw new KaneoApiError(`Kaneo API ${method} ${path} returned ${response.status}`, response.status, responseBody)
}

function validateResponse<T>(
  rawData: unknown,
  schema: ZodType<T>,
  method: string,
  path: string,
  statusCode: number,
): T {
  const result = schema.safeParse(rawData)
  if (!result.success) {
    log.error({ method, path, error: result.error }, 'Kaneo API response validation failed')
    throw new KaneoValidationError(`Kaneo API ${method} ${path} returned invalid data`, result.error)
  }
  log.debug({ method, path, statusCode }, 'Kaneo API response validated')
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
  const url = buildUrl(config, path, query)

  log.debug({ method, path, hasBody: body !== undefined }, 'Kaneo API request')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.sessionCookie === undefined) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  } else {
    headers['Cookie'] = config.sessionCookie
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    return handleErrorResponse(response, method, path)
  }

  const rawData: unknown = await response.json()

  return validateResponse(rawData, schema, method, path, response.status)
}
