// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'

const log = logger.child({ scope: 'youtrack:client' })

export type YouTrackConfig = {
  baseUrl: string
  token: string
}

export type YouTrackQueryValue = string | readonly string[]

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

/** Low-level fetch wrapper for the YouTrack REST API. */
export async function youtrackFetch(
  config: YouTrackConfig,
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, YouTrackQueryValue> },
): Promise<unknown> {
  const url = new URL(path, config.baseUrl)
  if (options?.query !== undefined) {
    appendQueryParams(url, options.query)
  }

  log.debug({ method, path, hasBody: options?.body !== undefined }, 'YouTrack API request')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text().catch(() => null)
    }
    const msg = `YouTrack API ${method} ${path} returned ${response.status}`
    log.error({ statusCode: response.status, path, errorBody }, msg)
    throw new YouTrackApiError(msg, response.status, errorBody)
  }

  if (response.status === 204) {
    return undefined
  }

  const data: unknown = await response.json()
  log.debug({ method, path }, 'YouTrack API response received')
  return data
}

/**
 * Multipart form-data upload for YouTrack attachments.
 * Uses repeated `upload` fields as required by the YouTrack API.
 */
export async function youtrackUpload(
  config: YouTrackConfig,
  path: string,
  file: { name: string; content: Uint8Array | Blob; mimeType?: string },
  query?: Record<string, YouTrackQueryValue>,
): Promise<unknown> {
  const url = new URL(path, config.baseUrl)
  if (query !== undefined) {
    appendQueryParams(url, query)
  }

  log.debug({ path, fileName: file.name }, 'YouTrack upload request')
  const blob =
    file.content instanceof Blob
      ? file.content
      : new Blob([Buffer.from(file.content)], {
          type: file.mimeType ?? 'application/octet-stream',
        })
  const form = new FormData()
  form.append('upload', blob, file.name)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
    },
    body: form,
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text().catch(() => null)
    }
    const msg = `YouTrack API POST ${path} returned ${response.status}`
    log.error({ statusCode: response.status, path, errorBody }, msg)
    throw new YouTrackApiError(msg, response.status, errorBody)
  }

  if (response.status === 204) {
    return undefined
  }

  const data: unknown = await response.json()
  log.debug({ path }, 'YouTrack upload response received')
  return data
}
