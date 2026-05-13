import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getUserMessage, systemError, webFetchError } from '../../src/errors.js'
import type { RateLimitResult, SafeFetchResponse, WebFetchResult } from '../../src/web/types.js'
import { expectAppError, mockLogger } from '../utils/test-helpers.js'

type FetchAndExtractDeps = {
  consumeWebFetchQuota: (actorId: string, nowMs?: number) => RateLimitResult
  normalizeWebUrl: (rawUrl: string) => string
  getCachedWebFetch: (normalizedUrl: string, nowMs?: number) => WebFetchResult | null
  putCachedWebFetch: (normalizedUrl: string, result: WebFetchResult, expiresAt: number) => void
  safeFetchContent: (url: string, options?: { abortSignal?: AbortSignal }) => Promise<SafeFetchResponse>
  extractHtmlContent: (html: string, url: string) => Promise<{ title: string; content: string }>
  extractPdfText: (bytes: Uint8Array) => Promise<string>
  distillWebContent: (input: {
    storageContextId: string
    title: string
    content: string
    goal?: string
  }) => Promise<{ summary: string; excerpt: string; truncated: boolean }>
  now: () => number
}

type FetchAndExtract = (
  input: {
    storageContextId: string
    actorUserId?: string
    url: string
    goal?: string
    abortSignal?: AbortSignal
  },
  deps?: FetchAndExtractDeps,
) => Promise<WebFetchResult>

function isFetchAndExtract(value: unknown): value is FetchAndExtract {
  return typeof value === 'function'
}

function getFetchAndExtract(value: unknown): FetchAndExtract {
  if (!isFetchAndExtract(value)) {
    throw new Error('fetchAndExtract was not loaded')
  }
  return value
}

function getDefaultTtl(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error('DEFAULT_TTL_MS was not loaded')
  }
  return value
}

function hasAppError(error: unknown): error is Error & { appError: unknown } {
  return error instanceof Error && 'appError' in error
}

function createUnexpectedCallError(name: string): Error {
  return new Error(name + ' should not be called')
}

describe('fetchAndExtract', () => {
  let fetchAndExtract: unknown
  let defaultTtlMs: unknown

  beforeEach(async () => {
    mockLogger()
    ;({ fetchAndExtract, DEFAULT_TTL_MS: defaultTtlMs } = await import('../../src/web/fetch-extract.js'))
  })

  test('returns a cache hit without fetching', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)
    const cached: WebFetchResult = {
      url: 'https://example.com/final',
      title: 'Cached title',
      summary: 'Cached summary',
      excerpt: 'Cached excerpt',
      truncated: false,
      contentType: 'text/html',
      source: 'cache',
      fetchedAt: 1_234,
    }

    const consumeWebFetchQuota = mock(
      (_actorId: string, _nowMs?: number): RateLimitResult => ({
        allowed: true,
        remaining: 19,
      }),
    )
    const normalizeWebUrl = mock((_rawUrl: string): string => 'https://example.com/article')
    const getCachedWebFetch = mock((_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => cached)

    const result = await runFetchAndExtract(
      {
        storageContextId: 'ctx-1',
        url: 'https://example.com/article?utm_source=test',
      },
      {
        consumeWebFetchQuota,
        normalizeWebUrl,
        getCachedWebFetch,
        putCachedWebFetch: (): void => {
          throw createUnexpectedCallError('putCachedWebFetch')
        },
        safeFetchContent: (): Promise<SafeFetchResponse> => {
          throw createUnexpectedCallError('safeFetchContent')
        },
        extractHtmlContent: (): Promise<{ title: string; content: string }> => {
          throw createUnexpectedCallError('extractHtmlContent')
        },
        extractPdfText: (): Promise<string> => {
          throw createUnexpectedCallError('extractPdfText')
        },
        distillWebContent: (): Promise<{ summary: string; excerpt: string; truncated: boolean }> => {
          throw createUnexpectedCallError('distillWebContent')
        },
        now: (): number => 1_000,
      },
    )

    expect(result).toEqual(cached)
    expect(consumeWebFetchQuota).toHaveBeenCalledWith('ctx-1', 1_000)
    expect(getCachedWebFetch).toHaveBeenCalledWith('https://example.com/article', 1_000)
  })

  test('uses actorUserId for quota and storageContextId for distillation and cache TTL', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)
    const putCachedWebFetch = mock((_normalizedUrl: string, _result: WebFetchResult, _expiresAt: number): void => {})
    const distillWebContent = mock(
      (input: {
        storageContextId: string
        title: string
        content: string
        goal?: string
      }): Promise<{ summary: string; excerpt: string; truncated: boolean }> =>
        Promise.resolve({
          summary: 'summary for ' + input.storageContextId,
          excerpt: input.content,
          truncated: false,
        }),
    )
    const consumeWebFetchQuota = mock(
      (_actorId: string, _nowMs?: number): RateLimitResult => ({
        allowed: true,
        remaining: 18,
      }),
    )

    const nowSequence: [number, number] = [1_000, 2_000]
    let nowCallIndex = 0
    const now = (): number => nowSequence[nowCallIndex++]!

    const result = await runFetchAndExtract(
      {
        storageContextId: 'storage-ctx',
        actorUserId: 'actor-7',
        url: 'https://example.com/path?utm_source=newsletter',
        goal: 'Capture action items',
      },
      {
        consumeWebFetchQuota,
        normalizeWebUrl: mock((_rawUrl: string): string => 'https://example.com/path'),
        getCachedWebFetch: mock((_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => null),
        putCachedWebFetch,
        safeFetchContent: mock(
          (_url: string, _options?: { abortSignal?: AbortSignal }): Promise<SafeFetchResponse> =>
            Promise.resolve({
              finalUrl: 'https://docs.example.org/final',
              contentType: 'text/plain',
              body: new TextEncoder().encode('Plain body content'),
            }),
        ),
        extractHtmlContent: (): Promise<{ title: string; content: string }> => {
          throw createUnexpectedCallError('extractHtmlContent')
        },
        extractPdfText: (): Promise<string> => {
          throw createUnexpectedCallError('extractPdfText')
        },
        distillWebContent,
        now,
      },
    )

    expect(getDefaultTtl(defaultTtlMs)).toBe(15 * 60 * 1000)
    expect(consumeWebFetchQuota).toHaveBeenCalledWith('actor-7', 1_000)
    expect(distillWebContent).toHaveBeenCalledWith({
      storageContextId: 'storage-ctx',
      title: 'docs.example.org',
      content: 'Plain body content',
      goal: 'Capture action items',
    })
    expect(putCachedWebFetch).toHaveBeenCalledWith(
      'https://example.com/path',
      {
        url: 'https://docs.example.org/final',
        title: 'docs.example.org',
        summary: 'summary for storage-ctx',
        excerpt: 'Plain body content',
        truncated: false,
        contentType: 'text/plain',
        source: 'fetch',
        fetchedAt: 2_000,
      },
      2_000 + getDefaultTtl(defaultTtlMs),
    )
    expect(result).toEqual({
      url: 'https://docs.example.org/final',
      title: 'docs.example.org',
      summary: 'summary for storage-ctx',
      excerpt: 'Plain body content',
      truncated: false,
      contentType: 'text/plain',
      source: 'fetch',
      fetchedAt: 2_000,
    })
  })

  test('uses extracted HTML title and content in the final result', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)
    const extractHtmlContent = mock(
      (_html: string, _url: string): Promise<{ title: string; content: string }> =>
        Promise.resolve({
          title: 'Readable title',
          content: 'Readable body',
        }),
    )
    const distillWebContent = mock(
      (input: {
        storageContextId: string
        title: string
        content: string
        goal?: string
      }): Promise<{ summary: string; excerpt: string; truncated: boolean }> => {
        expect(input).toEqual({
          storageContextId: 'ctx-2',
          title: 'Readable title',
          content: 'Readable body',
          goal: undefined,
        })
        return Promise.resolve({
          summary: 'Readable summary',
          excerpt: 'Readable excerpt',
          truncated: true,
        })
      },
    )

    const result = await runFetchAndExtract(
      {
        storageContextId: 'ctx-2',
        url: 'https://example.com/article',
      },
      {
        consumeWebFetchQuota: (_actorId: string, _nowMs?: number): RateLimitResult => ({
          allowed: true,
          remaining: 19,
        }),
        normalizeWebUrl: (_rawUrl: string): string => 'https://example.com/article',
        getCachedWebFetch: (_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => null,
        putCachedWebFetch: (_normalizedUrl: string, _result: WebFetchResult, _expiresAt: number): void => {},
        safeFetchContent: (_url: string, _options?: { abortSignal?: AbortSignal }): Promise<SafeFetchResponse> =>
          Promise.resolve({
            finalUrl: 'https://example.com/final',
            contentType: 'text/html',
            body: new TextEncoder().encode('<html><body>ignored</body></html>'),
          }),
        extractHtmlContent,
        extractPdfText: (): Promise<string> => {
          throw createUnexpectedCallError('extractPdfText')
        },
        distillWebContent,
        now: (): number => 5_000,
      },
    )

    expect(extractHtmlContent).toHaveBeenCalledWith('<html><body>ignored</body></html>', 'https://example.com/final')
    expect(result).toEqual({
      url: 'https://example.com/final',
      title: 'Readable title',
      summary: 'Readable summary',
      excerpt: 'Readable excerpt',
      truncated: true,
      contentType: 'text/html',
      source: 'fetch',
      fetchedAt: 5_000,
    })
  })

  test('throws a classified rate-limit error wrapper', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)

    try {
      await runFetchAndExtract(
        {
          storageContextId: 'ctx-3',
          url: 'https://example.com/blocked',
        },
        {
          consumeWebFetchQuota: (_actorId: string, _nowMs?: number): RateLimitResult => ({
            allowed: false,
            remaining: 0,
            retryAfterSec: 42,
          }),
          normalizeWebUrl: (_rawUrl: string): string => 'https://example.com/blocked',
          getCachedWebFetch: (_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => null,
          putCachedWebFetch: (_normalizedUrl: string, _result: WebFetchResult, _expiresAt: number): void => {
            throw createUnexpectedCallError('putCachedWebFetch')
          },
          safeFetchContent: (): Promise<SafeFetchResponse> => {
            throw createUnexpectedCallError('safeFetchContent')
          },
          extractHtmlContent: (): Promise<{ title: string; content: string }> => {
            throw createUnexpectedCallError('extractHtmlContent')
          },
          extractPdfText: (): Promise<string> => {
            throw createUnexpectedCallError('extractPdfText')
          },
          distillWebContent: (): Promise<{ summary: string; excerpt: string; truncated: boolean }> => {
            throw createUnexpectedCallError('distillWebContent')
          },
          now: (): number => 8_000,
        },
      )
      throw new Error('Expected fetchAndExtract to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expectAppError(error, getUserMessage(webFetchError.rateLimited()))
      assert(hasAppError(error), 'Expected error with appError')
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'rate-limited',
        retryAfterSec: 42,
        appError: webFetchError.rateLimited(),
      })
    }
  })

  test('rejects invalid URLs before consuming quota', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)
    const consumeWebFetchQuota = mock(
      (_actorId: string, _nowMs?: number): RateLimitResult => ({
        allowed: true,
        remaining: 19,
      }),
    )

    try {
      await runFetchAndExtract(
        {
          storageContextId: 'ctx-4',
          url: 'not-a-url',
        },
        {
          consumeWebFetchQuota,
          normalizeWebUrl: () => {
            throw new Error('bad url')
          },
          getCachedWebFetch: (_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => null,
          putCachedWebFetch: (_normalizedUrl: string, _result: WebFetchResult, _expiresAt: number): void => {
            throw createUnexpectedCallError('putCachedWebFetch')
          },
          safeFetchContent: (): Promise<SafeFetchResponse> => {
            throw createUnexpectedCallError('safeFetchContent')
          },
          extractHtmlContent: (): Promise<{ title: string; content: string }> => {
            throw createUnexpectedCallError('extractHtmlContent')
          },
          extractPdfText: (): Promise<string> => {
            throw createUnexpectedCallError('extractPdfText')
          },
          distillWebContent: (): Promise<{ summary: string; excerpt: string; truncated: boolean }> => {
            throw createUnexpectedCallError('distillWebContent')
          },
          now: (): number => 9_000,
        },
      )
      throw new Error('Expected fetchAndExtract to reject')
    } catch (error) {
      expect(consumeWebFetchQuota).not.toHaveBeenCalled()
      expectAppError(error, getUserMessage(webFetchError.invalidUrl()))
      assert(hasAppError(error), 'Expected error with appError')
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'invalid-url',
        appError: webFetchError.invalidUrl(),
      })
    }
  })

  test('routes PDF content through extractPdfText before distillation', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)
    const extractPdfText = mock((_bytes: Uint8Array): Promise<string> => Promise.resolve('Extracted PDF body'))
    const distillWebContent = mock(
      (input: {
        storageContextId: string
        title: string
        content: string
        goal?: string
      }): Promise<{ summary: string; excerpt: string; truncated: boolean }> =>
        Promise.resolve({
          summary: `Summary for ${input.title}`,
          excerpt: input.content,
          truncated: false,
        }),
    )

    const result = await runFetchAndExtract(
      {
        storageContextId: 'ctx-pdf',
        url: 'https://example.com/report.pdf',
      },
      {
        consumeWebFetchQuota: (_actorId: string, _nowMs?: number): RateLimitResult => ({
          allowed: true,
          remaining: 19,
        }),
        normalizeWebUrl: (_rawUrl: string): string => 'https://example.com/report.pdf',
        getCachedWebFetch: (_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => null,
        putCachedWebFetch: (_normalizedUrl: string, _result: WebFetchResult, _expiresAt: number): void => {},
        safeFetchContent: (_url: string, _options?: { abortSignal?: AbortSignal }): Promise<SafeFetchResponse> =>
          Promise.resolve({
            finalUrl: 'https://cdn.example.com/final-report.pdf',
            contentType: 'application/pdf',
            body: new Uint8Array([1, 2, 3]),
          }),
        extractHtmlContent: (): Promise<{ title: string; content: string }> => {
          throw createUnexpectedCallError('extractHtmlContent')
        },
        extractPdfText,
        distillWebContent,
        now: (): number => 10_000,
      },
    )

    expect(extractPdfText).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(distillWebContent).toHaveBeenCalledWith({
      storageContextId: 'ctx-pdf',
      title: 'cdn.example.com',
      content: 'Extracted PDF body',
      goal: undefined,
    })
    expect(result).toEqual({
      url: 'https://cdn.example.com/final-report.pdf',
      title: 'cdn.example.com',
      summary: 'Summary for cdn.example.com',
      excerpt: 'Extracted PDF body',
      truncated: false,
      contentType: 'application/pdf',
      source: 'fetch',
      fetchedAt: 10_000,
    })
  })

  test('classifies unexpected distillation failures', async () => {
    const runFetchAndExtract = getFetchAndExtract(fetchAndExtract)

    try {
      await runFetchAndExtract(
        {
          storageContextId: 'ctx-5',
          url: 'https://example.com/article',
        },
        {
          consumeWebFetchQuota: (_actorId: string, _nowMs?: number): RateLimitResult => ({
            allowed: true,
            remaining: 19,
          }),
          normalizeWebUrl: (_rawUrl: string): string => 'https://example.com/article',
          getCachedWebFetch: (_normalizedUrl: string, _nowMs?: number): WebFetchResult | null => null,
          putCachedWebFetch: (_normalizedUrl: string, _result: WebFetchResult, _expiresAt: number): void => {
            throw createUnexpectedCallError('putCachedWebFetch')
          },
          safeFetchContent: (_url: string, _options?: { abortSignal?: AbortSignal }): Promise<SafeFetchResponse> =>
            Promise.resolve({
              finalUrl: 'https://example.com/final',
              contentType: 'text/plain',
              body: new TextEncoder().encode('Plain body content'),
            }),
          extractHtmlContent: (): Promise<{ title: string; content: string }> => {
            throw createUnexpectedCallError('extractHtmlContent')
          },
          extractPdfText: (): Promise<string> => {
            throw createUnexpectedCallError('extractPdfText')
          },
          distillWebContent: (): Promise<{ summary: string; excerpt: string; truncated: boolean }> => {
            throw new Error('llm exploded')
          },
          now: (): number => 11_000,
        },
      )
      throw new Error('Expected fetchAndExtract to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(systemError.unexpected(new Error('llm exploded'))))
      assert(hasAppError(error), 'Expected error with appError')
      expect(error).toMatchObject({
        type: 'system',
        code: 'unexpected',
        appError: {
          type: 'system',
          code: 'unexpected',
        },
      })
    }
  })
})
