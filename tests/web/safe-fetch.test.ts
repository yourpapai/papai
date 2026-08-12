// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import {
  assertPublicUrl,
  safeFetchContent,
  setAssertPublicUrlForTesting,
  type SafeFetchDeps,
} from '../../src/web/safe-fetch.js'
import { expectAppError, mockLogger, restoreFetch, setMockFetch } from '../utils/test-helpers.js'

function createFetchMock(impl: (...args: Parameters<typeof fetch>) => Promise<Response>): typeof fetch {
  return Object.assign(impl, { preconnect: fetch.preconnect })
}

function hasAppError(error: unknown): error is Error & { appError: unknown } {
  return error instanceof Error && 'appError' in error
}

function makeRedirectThenSuccessFetch(): typeof fetch {
  let fetchCount = 0
  return createFetchMock((..._args: Parameters<typeof fetch>): Promise<Response> => {
    fetchCount += 1
    if (fetchCount === 1) {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/final' },
        }),
      )
    }
    return Promise.resolve(
      new Response('<html><body>Hello</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
  })
}

describe('safeFetchContent', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('validates the initial URL and each redirect target', async () => {
    const assertPublicUrlMock = mock((_url: URL): Promise<void> => Promise.resolve())
    const fetchMock = makeRedirectThenSuccessFetch()

    const result = await safeFetchContent(
      'https://example.com/start',
      { abortSignal: AbortSignal.timeout(1000) },
      { fetch: fetchMock, assertPublicUrl: assertPublicUrlMock },
    )

    expect(result.finalUrl).toBe('https://example.com/final')
    expect(result.contentType).toBe('text/html')
    expect(new TextDecoder().decode(result.body)).toContain('Hello')
    expect(assertPublicUrlMock).toHaveBeenCalledTimes(2)
  })

  test('rejects unsupported content types', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock(
        (..._args: Parameters<typeof fetch>): Promise<Response> =>
          Promise.resolve(
            new Response('not allowed', {
              status: 200,
              headers: { 'content-type': 'image/png' },
            }),
          ),
      ),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/file', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.blockedContentType()))
      assert(hasAppError(error))
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'blocked-content-type',
        appError: webFetchError.blockedContentType(),
      })
    }
  })

  test('accepts content types case-insensitively', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock(
        (..._args: Parameters<typeof fetch>): Promise<Response> =>
          Promise.resolve(
            new Response('<html><body>Hello</body></html>', {
              status: 200,
              headers: { 'content-type': 'TEXT/HTML; charset=utf-8' },
            }),
          ),
      ),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    await expect(
      safeFetchContent('https://example.com/mixed-case', { abortSignal: AbortSignal.timeout(1000) }, deps),
    ).resolves.toMatchObject({
      finalUrl: 'https://example.com/mixed-case',
      contentType: 'text/html',
    })
  })

  test('rejects oversized text bodies', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock(
        (..._args: Parameters<typeof fetch>): Promise<Response> =>
          Promise.resolve(
            new Response('x'.repeat(2_000_001), {
              status: 200,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            }),
          ),
      ),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/large', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.tooLarge()))
      assert(hasAppError(error))
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'too-large',
        appError: webFetchError.tooLarge(),
      })
    }
  })

  test('maps timeout errors to the web-fetch timeout shape', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock((_input: Parameters<typeof fetch>[0]): Promise<Response> => {
        throw new DOMException('Timed out', 'TimeoutError')
      }),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/slow', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.timeout()))
      assert(hasAppError(error))
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'timeout',
        appError: webFetchError.timeout(),
      })
    }
  })

  test('maps URL-validation timeouts to the web-fetch timeout shape', async () => {
    const abortController = new AbortController()
    abortController.abort(new DOMException('Timed out', 'TimeoutError'))

    const deps: SafeFetchDeps = {
      fetch: createFetchMock((_input: Parameters<typeof fetch>[0]): Promise<Response> => {
        throw new Error('fetch should not be called when validation times out')
      }),
      assertPublicUrl: (): Promise<void> => new Promise(() => {}),
    }

    try {
      await safeFetchContent('https://example.com/slow', { abortSignal: abortController.signal }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.timeout()))
      assert(hasAppError(error))
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'timeout',
        appError: webFetchError.timeout(),
      })
    }
  })

  test('blocks IPv4-mapped and NAT64 loopback literals', async () => {
    for (const rawUrl of ['http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::7f00:1]/']) {
      try {
        await assertPublicUrl(new URL(rawUrl))
        throw new Error('Expected assertPublicUrl to reject')
      } catch (error) {
        expectAppError(error, getUserMessage(webFetchError.blockedHost()))
        assert(hasAppError(error))
        expect(error).toMatchObject({
          type: 'web-fetch',
          code: 'blocked-host',
          appError: webFetchError.blockedHost(),
        })
      }
    }
  })

  test('classifies non-abort fetch failures as upstream errors', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock((_input: Parameters<typeof fetch>[0]): Promise<Response> => {
        throw new TypeError('fetch failed')
      }),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/down', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.upstreamError()))
      assert(hasAppError(error))
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'upstream-error',
        appError: webFetchError.upstreamError(),
      })
    }
  })
})

describe('defaultDeps.fetch (live global lookup)', () => {
  afterEach(() => {
    restoreFetch()
    setAssertPublicUrlForTesting(undefined)
  })

  test('reads globalThis.fetch at call time, not at module-eval time', async () => {
    // Bypass the DNS guard so control reaches deps.fetch.
    setAssertPublicUrlForTesting(() => Promise.resolve())
    let called = 0
    setMockFetch((_url, _init) => {
      called += 1
      return Promise.resolve(
        new Response('<html><body>ok</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      )
    })

    // No deps arg → defaultDeps.fetch. If it had captured the original fetch at module-eval, the
    // freshly-installed mock would NOT be hit; a live global read means it is.
    await safeFetchContent('http://example.com/live', { abortSignal: AbortSignal.timeout(1000) })
    expect(called).toBe(1)
  })
})

describe('setAssertPublicUrlForTesting (module override)', () => {
  beforeEach(() => {
    mockLogger()
  })
  afterEach(() => {
    setAssertPublicUrlForTesting(undefined)
  })

  test('defaultDeps.assertPublicUrl delegates to the override when one is set', async () => {
    const override = mock((_url: URL): Promise<void> => Promise.reject(new Error('override-active')))
    setAssertPublicUrlForTesting(override)

    // No deps arg → safeFetchContent uses defaultDeps, whose assertPublicUrl must route to override.
    // The override rejects before any fetch, so no network is touched.
    await expect(
      safeFetchContent('http://[::ffff:127.0.0.1]/', { abortSignal: AbortSignal.timeout(1000) }),
    ).rejects.toBeInstanceOf(Error)
    expect(override).toHaveBeenCalledTimes(1)
  })

  test('clearing the override restores the real public-URL guard', async () => {
    setAssertPublicUrlForTesting(() => Promise.resolve())
    setAssertPublicUrlForTesting(undefined)

    // Real guard runs again (no deps arg) and rejects the loopback literal with blocked-host —
    // proving no scenario can leak a bypassed guard after teardown.
    try {
      await safeFetchContent('http://[::ffff:127.0.0.1]/', { abortSignal: AbortSignal.timeout(1000) })
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.blockedHost()))
    }
  })
})
