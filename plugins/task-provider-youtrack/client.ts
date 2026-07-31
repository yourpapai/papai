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

const log = logger.child({ scope: 'youtrack:client' })

export type YouTrackConfig = {
  baseUrl: string
  token: string
}

export type YouTrackQueryValue = string | readonly string[]

type BoundaryOperation = 'read' | 'search' | 'create' | 'update' | 'delete' | 'connect' | 'stream' | 'other'

const operationOf = (method: string): BoundaryOperation => {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'read'
    case 'POST':
      return 'create'
    case 'PUT':
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
      provider: 'youtrack',
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

const appendQueryParams = (url: URL, query: Record<string, YouTrackQueryValue>): void => {
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') {
      for (const item of value) {
        url.searchParams.append(key, item)
      }
      continue
    }
    url.searchParams.set(key, value)
  }
}

export class YouTrackApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'YouTrackApiError'
  }
}

const readErrorBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return response.text().catch(() => null)
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
      log.error({ statusCode: response.status }, `YouTrack ${label} failed`)
      throw new YouTrackApiError(
        `YouTrack API ${label} failed with status ${response.status}`,
        response.status,
        errorBody,
      )
    }
    if (response.status === 204) return undefined
    const data: unknown = await response.json()
    log.debug({ statusCode: response.status }, `YouTrack ${label} response received`)
    return data
  } catch (error) {
    caught = error
    throw error
  } finally {
    observeBoundary(scope, clock, operation, caught, status)
  }
}

/** Low-level fetch wrapper for the YouTrack REST API. */
export function youtrackFetch(
  config: YouTrackConfig,
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, YouTrackQueryValue> },
): Promise<unknown> {
  return Promise.resolve().then(() => {
    const scope = requireProviderRequestScope()
    const clock = createProviderRequestClock()
    const url = new URL(path, config.baseUrl)
    if (options?.query !== undefined) {
      appendQueryParams(url, options.query)
    }

    log.debug({ method, hasBody: options?.body !== undefined }, 'YouTrack API request')

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
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

/**
 * Multipart form-data upload for YouTrack attachments.
 * Uses repeated `upload` fields as required by the YouTrack API.
 */
export function youtrackUpload(
  config: YouTrackConfig,
  path: string,
  file: { name: string; content: Uint8Array | Blob; mimeType?: string },
  query?: Record<string, YouTrackQueryValue>,
): Promise<unknown> {
  return Promise.resolve().then(() => {
    const scope = requireProviderRequestScope()
    const clock = createProviderRequestClock()
    const url = new URL(path, config.baseUrl)
    if (query !== undefined) {
      appendQueryParams(url, query)
    }

    const byteLength = file.content instanceof Blob ? file.content.size : file.content.byteLength
    log.debug({ byteLength, hasMimeType: file.mimeType !== undefined }, 'YouTrack upload request')
    const blob =
      file.content instanceof Blob
        ? file.content
        : new Blob([Buffer.from(file.content)], {
            type: file.mimeType ?? 'application/octet-stream',
          })
    const form = new FormData()
    form.append('upload', blob, file.name)

    return executeObservedRequest(scope, clock, 'create', 'upload', () =>
      fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json',
        },
        body: form,
      }),
    )
  })
}
