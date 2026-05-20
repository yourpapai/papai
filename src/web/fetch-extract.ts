// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAppError, systemError, type AppError, webFetchError } from '../errors.js'
import { logger } from '../logger.js'
import { getCachedWebFetch, putCachedWebFetch } from './cache.js'
import { distillWebContent } from './distill.js'
import { extractHtmlContent } from './extract.js'
import { extractPdfText } from './pdf.js'
import { consumeWebFetchQuota } from './rate-limit.js'
import { safeFetchContent } from './safe-fetch.js'
import type { RateLimitResult, SafeFetchResponse, WebFetchResult } from './types.js'
import { normalizeWebUrl } from './url-normalize.js'

const log = logger.child({ scope: 'web:fetch-extract' })
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml'])

export const DEFAULT_TTL_MS = 15 * 60 * 1000

type FetchAndExtractInput = {
  storageContextId: string
  actorUserId?: string
  contextType?: 'dm' | 'group'
  url: string
  goal?: string
  abortSignal?: AbortSignal
}

type ProcessedWebContent = {
  title: string
  content: string
}

class FetchAndExtractClassifiedError extends Error {
  readonly type: AppError['type']
  readonly code: AppError['code']
  readonly status?: number
  readonly retryAfterSec?: number

  constructor(
    message: string,
    public readonly appError: AppError,
    retryAfterSec?: number,
  ) {
    super(message)
    this.name = 'FetchAndExtractClassifiedError'
    this.type = appError.type
    this.code = appError.code
    this.retryAfterSec = retryAfterSec
    if ('status' in appError && appError.status !== undefined) {
      this.status = appError.status
    }
  }
}

export interface FetchAndExtractDeps {
  consumeWebFetchQuota: (actorId: string, nowMs?: number) => RateLimitResult
  normalizeWebUrl: typeof normalizeWebUrl
  getCachedWebFetch: typeof getCachedWebFetch
  putCachedWebFetch: typeof putCachedWebFetch
  safeFetchContent: (url: string, options?: { abortSignal?: AbortSignal }) => Promise<SafeFetchResponse>
  extractHtmlContent: typeof extractHtmlContent
  extractPdfText: typeof extractPdfText
  distillWebContent: typeof distillWebContent
  now: () => number
}

const defaultDeps: FetchAndExtractDeps = {
  consumeWebFetchQuota,
  normalizeWebUrl,
  getCachedWebFetch,
  putCachedWebFetch,
  safeFetchContent,
  extractHtmlContent,
  extractPdfText,
  distillWebContent,
  now: () => Date.now(),
}

function throwClassifiedError(appError: AppError, message: string, retryAfterSec?: number): never {
  throw new FetchAndExtractClassifiedError(message, appError, retryAfterSec)
}

function getDefaultTitle(finalUrl: string): string {
  return new URL(finalUrl).hostname
}

function decodeBody(body: Uint8Array): string {
  return new TextDecoder().decode(body)
}

function normalizeUrl(rawUrl: string, deps: FetchAndExtractDeps): string {
  try {
    return deps.normalizeWebUrl(rawUrl)
  } catch (error) {
    log.warn(
      { rawUrl, error: error instanceof Error ? error.message : String(error) },
      'Web fetch URL normalization failed',
    )
    return throwClassifiedError(webFetchError.invalidUrl(), 'Invalid URL')
  }
}

function logFetchStart(input: FetchAndExtractInput, actorId: string): void {
  log.debug(
    {
      storageContextId: input.storageContextId,
      actorId,
      url: input.url,
      hasGoal: input.goal !== undefined,
    },
    'fetchAndExtract',
  )
}

function enforceQuota(actorId: string, requestStartedAt: number, deps: FetchAndExtractDeps): void {
  const quota = deps.consumeWebFetchQuota(actorId, requestStartedAt)
  if (!quota.allowed) {
    log.warn({ actorId, retryAfterSec: quota.retryAfterSec }, 'Web fetch quota exceeded')
    throwClassifiedError(webFetchError.rateLimited(), 'Web fetch quota exceeded', quota.retryAfterSec)
  }
}

function getCachedResult(
  input: FetchAndExtractInput,
  actorId: string,
  normalizedUrl: string,
  requestStartedAt: number,
  deps: FetchAndExtractDeps,
): WebFetchResult | null {
  const cached = deps.getCachedWebFetch(normalizedUrl, requestStartedAt)
  if (cached !== null) {
    log.info(
      { actorId, storageContextId: input.storageContextId, normalizedUrl, finalUrl: cached.url },
      'Returned cached web fetch result',
    )
  }
  return cached
}

async function resolveProcessedContent(
  fetched: SafeFetchResponse,
  deps: FetchAndExtractDeps,
): Promise<ProcessedWebContent> {
  if (fetched.contentType === 'application/pdf') {
    return {
      title: getDefaultTitle(fetched.finalUrl),
      content: await deps.extractPdfText(fetched.body),
    }
  }

  const decodedBody = decodeBody(fetched.body)
  if (HTML_CONTENT_TYPES.has(fetched.contentType)) {
    return deps.extractHtmlContent(decodedBody, fetched.finalUrl)
  }

  return {
    title: getDefaultTitle(fetched.finalUrl),
    content: decodedBody,
  }
}

function buildResult(
  fetched: SafeFetchResponse,
  fetchedAt: number,
  processed: ProcessedWebContent,
  distilled: Awaited<ReturnType<FetchAndExtractDeps['distillWebContent']>>,
): WebFetchResult {
  return {
    url: fetched.finalUrl,
    title: processed.title,
    summary: distilled.summary,
    excerpt: distilled.excerpt,
    truncated: distilled.truncated,
    contentType: fetched.contentType,
    source: 'fetch',
    fetchedAt,
  }
}

async function distillProcessedContent(
  input: FetchAndExtractInput,
  processed: ProcessedWebContent,
  deps: FetchAndExtractDeps,
): Promise<Awaited<ReturnType<FetchAndExtractDeps['distillWebContent']>>> {
  try {
    return await deps.distillWebContent({
      storageContextId: input.storageContextId,
      title: processed.title,
      content: processed.content,
      goal: input.goal,
      ...(input.contextType === undefined ? {} : { contextType: input.contextType }),
      ...(input.actorUserId === undefined ? {} : { chatUserId: input.actorUserId }),
    })
  } catch (error) {
    if (isAppError(error)) {
      throw error
    }

    const originalError = error instanceof Error ? error : new Error(String(error))
    log.error(
      {
        storageContextId: input.storageContextId,
        title: processed.title,
        error: originalError.message,
      },
      'Web content distillation failed',
    )
    return throwClassifiedError(systemError.unexpected(originalError), 'Web content distillation failed')
  }
}

export async function fetchAndExtract(
  input: FetchAndExtractInput,
  overrides: Partial<FetchAndExtractDeps> = {},
): Promise<WebFetchResult> {
  const deps: FetchAndExtractDeps = { ...defaultDeps, ...overrides }
  const actorId = input.actorUserId ?? input.storageContextId
  const requestStartedAt = deps.now()

  logFetchStart(input, actorId)
  const normalizedUrl = normalizeUrl(input.url, deps)
  enforceQuota(actorId, requestStartedAt, deps)
  const cached = getCachedResult(input, actorId, normalizedUrl, requestStartedAt, deps)
  if (cached !== null) {
    return cached
  }

  const fetched = await deps.safeFetchContent(normalizedUrl, { abortSignal: input.abortSignal })
  const fetchedAt = deps.now()
  const processed = await resolveProcessedContent(fetched, deps)
  const distilled = await distillProcessedContent(input, processed, deps)

  const result = buildResult(fetched, fetchedAt, processed, distilled)
  deps.putCachedWebFetch(normalizedUrl, result, fetchedAt + DEFAULT_TTL_MS)

  log.info(
    {
      actorId,
      storageContextId: input.storageContextId,
      normalizedUrl,
      finalUrl: result.url,
      contentType: result.contentType,
      fetchedAt,
    },
    'Fetched and extracted web content',
  )

  return result
}
