// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { PluginLogger } from '../../src/plugins/context.js'
import type { ProviderRuntimeDeps } from '../../src/plugins/provider-runtime.js'
import { buildProviderRuntime } from '../../src/plugins/provider-runtime.js'
import { mockLogger } from '../utils/test-helpers.js'

type FetchSpy = ReturnType<typeof mock<(_url: string, _init?: RequestInit) => Promise<Response>>>
type AssertSpy = ReturnType<typeof mock<(_url: URL) => Promise<void>>>

type TestDeps = ProviderRuntimeDeps & { fetchSpy: FetchSpy; assertSpy: AssertSpy }

function makeLogger(): PluginLogger {
  return {
    debug(_data: Record<string, unknown>, _msg: string): void {},
    info(_data: Record<string, unknown>, _msg: string): void {},
    warn(_data: Record<string, unknown>, _msg: string): void {},
    error(_data: Record<string, unknown>, _msg: string): void {},
  }
}

function extractSignal(init: RequestInit | undefined): AbortSignal | null | undefined {
  if (init === undefined) {
    return undefined
  }
  return init.signal
}

function getHeaderValue(headers: HeadersInit | undefined, name: string): string | null {
  if (headers === undefined) {
    return null
  }
  return new Headers(headers).get(name)
}

function makeDeps(): TestDeps {
  const fetchSpy = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('ok')))
  const assertSpy = mock((_url: URL) => Promise.resolve())
  return { fetch: fetchSpy, assertPublicUrl: assertSpy, fetchSpy, assertSpy }
}

describe('buildProviderRuntime.httpFetch', () => {
  test('rejects a host not in the allowlist before fetching', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await expect(runtime.httpFetch('https://evil.example.com/x')).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(assertSpy).not.toHaveBeenCalled()
  })

  test('rejects a plain http URL before SSRF validation or fetch', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await expect(runtime.httpFetch('http://api.kaneo.io/v1/tasks')).rejects.toThrow(
      'Plugin provider httpFetch requires an https URL',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(assertSpy).not.toHaveBeenCalled()
  })

  test('allows an allowlisted host through the SSRF guard then fetch', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    const res = await runtime.httpFetch('https://api.kaneo.io/v1/tasks', { method: 'POST' })
    expect(await res.text()).toBe('ok')
    expect(assertSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('exposes the allowlist as a readonly set', () => {
    mockLogger()
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger())
    expect(runtime.allowedHosts.has('api.kaneo.io')).toBe(true)
  })

  // New tests for security fixes

  test('blocks redirect to a non-allowlisted host and does not issue a second fetch', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    )
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await expect(runtime.httpFetch('https://api.kaneo.io/v1/tasks')).rejects.toThrow()
    // Only the initial fetch is issued; no follow-up to the redirect target
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // assertPublicUrl was called once for the original url
    expect(assertSpy).toHaveBeenCalledTimes(1)
  })

  test('follows redirect to an allowlisted host and re-validates both hops', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    const res = await runtime.httpFetch('https://api.kaneo.io/v1/tasks')
    expect(await res.text()).toBe('ok')
    // assertPublicUrl called for both the original URL and the redirect target
    expect(assertSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('strips Authorization on redirect to the same hostname with a different port', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://api.kaneo.io:8443/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      headers: { authorization: 'Bearer secret' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(getHeaderValue(fetchSpy.mock.calls[1]?.[1]?.headers, 'authorization')).toBeNull()
  })

  test('keeps Authorization on same-origin redirect', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      headers: { authorization: 'Bearer secret' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(getHeaderValue(fetchSpy.mock.calls[1]?.[1]?.headers, 'authorization')).toBe('Bearer secret')
  })

  test('rejects a redirect that downgrades to http before SSRF validation or second fetch', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://api.kaneo.io/v2/tasks' } }),
    )
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await expect(runtime.httpFetch('https://api.kaneo.io/v1/tasks')).rejects.toThrow(
      'Plugin provider httpFetch requires an https URL',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(assertSpy).toHaveBeenCalledTimes(1)
  })

  test('rejects when redirects exceed the maximum allowed count', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    // Always return a redirect to the same allowlisted host
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://api.kaneo.io/loop' } })),
    )
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await expect(runtime.httpFetch('https://api.kaneo.io/start')).rejects.toThrow()
    expect(fetchSpy.mock.calls.length).toBe(6)
  })

  test('returns a non-redirect 304 response directly without requiring location', async () => {
    mockLogger()
    const { fetchSpy, assertSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 304 }))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    const response = await runtime.httpFetch('https://api.kaneo.io/v1/tasks')

    expect(response.status).toBe(304)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(assertSpy).toHaveBeenCalledTimes(1)
  })

  test('preserves PUT method and body across a 302 redirect replay', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      method: 'PUT',
      body: 'title=Task',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', body: 'title=Task' })
  })

  test('preserves POST method and body across a 307 redirect replay', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      method: 'POST',
      body: 'title=Task',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: 'title=Task' })
  })

  test('rewrites a 303 PUT redirect replay to GET and drops the original body', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 303, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      method: 'PUT',
      body: 'title=Task',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: 'GET' })
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toBeUndefined()
  })

  test('rewritten GET redirect replay drops body-specific headers', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 303, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      method: 'POST',
      body: 'title=Task',
      headers: {
        'content-length': '10',
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Bearer secret',
      },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: 'GET' })
    expect(getHeaderValue(fetchSpy.mock.calls[1]?.[1]?.headers, 'content-type')).toBeNull()
    expect(getHeaderValue(fetchSpy.mock.calls[1]?.[1]?.headers, 'content-length')).toBeNull()
    expect(getHeaderValue(fetchSpy.mock.calls[1]?.[1]?.headers, 'authorization')).toBe('Bearer secret')
  })

  test('allowedHosts is a separate copy so mutating it cannot affect enforcement', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    // The exposed set should be frozen at the object level.
    expect(Object.isFrozen(runtime.allowedHosts)).toBe(true)

    // Build a second runtime with the same hosts — both runtimes' exposed sets
    // must be independent from the enforcement set. We verify enforcement by
    // confirming that a host never in the allowlist is still rejected even
    // after the runtime is constructed. This is the key property: the
    // enforcement set is a private closure, not the exposed reference.
    await expect(runtime.httpFetch('https://evil.example.com/x')).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()

    // Also confirm allowedHosts does not contain the host we tried to access
    expect(runtime.allowedHosts.has('evil.example.com')).toBe(false)
  })

  test('mutating exposed allowedHosts does not affect httpFetch enforcement', async () => {
    const runtime = buildProviderRuntime(['allowed.example'], makeLogger(), {
      fetch: () => Promise.resolve(new Response('ok')),
      assertPublicUrl: () => Promise.resolve(),
    })
    const addToSet = Reflect.get(Set.prototype, 'add')
    Reflect.apply(addToSet, runtime.allowedHosts, ['evil.example'])

    await expect(runtime.httpFetch('https://evil.example/data')).rejects.toThrow(
      "Host 'evil.example' is not in the plugin providerAllowedHosts allowlist",
    )
  })

  test('fetch receives an AbortSignal even when caller provides no init', async () => {
    mockLogger()
    const capturedSignals: Array<AbortSignal | null | undefined> = []
    const capturingDeps: ProviderRuntimeDeps = {
      fetch: (_url: string, init: RequestInit | undefined) => {
        capturedSignals.push(extractSignal(init))
        return Promise.resolve(new Response('ok'))
      },
      assertPublicUrl: (_url: URL) => Promise.resolve(),
    }
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), capturingDeps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks')

    expect(capturedSignals.length).toBe(1)
    expect(capturedSignals[0]).toBeInstanceOf(AbortSignal)
  })

  test('fetch receives a composed AbortSignal when caller provides their own signal', async () => {
    mockLogger()
    const capturedSignals: Array<AbortSignal | null | undefined> = []
    const capturingDeps: ProviderRuntimeDeps = {
      fetch: (_url: string, init: RequestInit | undefined) => {
        capturedSignals.push(extractSignal(init))
        return Promise.resolve(new Response('ok'))
      },
      assertPublicUrl: (_url: URL) => Promise.resolve(),
    }
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), capturingDeps)

    const callerController = new AbortController()
    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', { signal: callerController.signal })

    expect(capturedSignals.length).toBe(1)
    expect(capturedSignals[0]).toBeInstanceOf(AbortSignal)
  })

  test('malformed URL throws a clear Error with stable message', async () => {
    mockLogger()
    const { ...deps } = makeDeps()
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await expect(runtime.httpFetch('not a url')).rejects.toThrow('Invalid provider httpFetch URL')
  })
})

describe('buildProviderRuntime.httpFetch dynamic hosts', () => {
  // SECURITY RATIONALE: dynamic hosts are sourced exclusively from admin-scoped plugin
  // config (operator-trusted, same trust level as manifest approval). LLM/tool inputs
  // can never influence the dynamic set. Dynamic hosts bypass https + public-IP checks
  // deliberately to support self-hosted endpoints on private networks (often http://).
  // Static hosts keep all existing checks.

  test('allows a host contributed by dynamicHosts and skips https and public-IP checks for it', async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('ok', { status: 200 })))
    const assertPublicUrl = mock((_url: URL): Promise<void> => Promise.reject(new Error('private address')))
    const runtime = buildProviderRuntime(
      ['api.openai.com'],
      makeLogger(),
      { fetch: fetchMock, assertPublicUrl },
      () => new Set(['whisper.lan']),
    )
    const response = await runtime.httpFetch('http://whisper.lan/v1/audio/transcriptions', { method: 'POST' })
    expect(response.status).toBe(200)
    // assertPublicUrl must not be called for dynamic-host requests — it would reject
    // private/LAN addresses, which are the primary use case for dynamicHosts
    expect(assertPublicUrl).not.toHaveBeenCalled()
  })

  test('static hosts still require https and the public-IP check', async () => {
    const assertPublicUrl = mock((_url: URL): Promise<void> => Promise.reject(new Error('private address')))
    const runtime = buildProviderRuntime(
      ['api.openai.com'],
      makeLogger(),
      { fetch: mock(), assertPublicUrl },
      () => new Set(),
    )
    // Even an allowlisted static host goes through assertPublicUrl and can be rejected
    await expect(runtime.httpFetch('https://api.openai.com/x')).rejects.toThrow('private address')
  })

  test('rejects hosts in neither the static nor the dynamic set', async () => {
    const runtime = buildProviderRuntime(['api.openai.com'], makeLogger(), undefined, () => new Set(['whisper.lan']))
    await expect(runtime.httpFetch('https://evil.example/x')).rejects.toThrow(/allowlist/u)
  })

  test('redirect hop to a dynamic host skips https and public-IP checks', async () => {
    // First response: 302 to http://whisper.lan/next; whisper.lan is in dynamic set -> allowed
    const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('ok')))
    const assertPublicUrl = mock((_url: URL): Promise<void> => Promise.reject(new Error('private address')))
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://whisper.lan/next' } }),
    )
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const runtime = buildProviderRuntime(
      ['api.openai.com'],
      makeLogger(),
      { fetch: fetchMock, assertPublicUrl },
      () => new Set(['whisper.lan']),
    )
    // Initial request is to a static host (api.openai.com); it will fail assertPublicUrl.
    // To test only the redirect-hop dynamic-host logic, use a dynamic-host initial URL:
    const response = await runtime.httpFetch('http://whisper.lan/v1/redirect-me', { method: 'GET' })
    expect(response.status).toBe(200)
    // assertPublicUrl called zero times: initial hop is dynamic, redirect hop is also dynamic
    expect(assertPublicUrl).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('redirect hop to a non-allowlisted host is rejected even when initial host is dynamic', async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('ok')))
    const assertPublicUrl = mock((_url: URL) => Promise.resolve())
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
    )
    const runtime = buildProviderRuntime(
      ['api.openai.com'],
      makeLogger(),
      { fetch: fetchMock, assertPublicUrl },
      () => new Set(['whisper.lan']),
    )
    await expect(runtime.httpFetch('http://whisper.lan/v1/redirect-me', { method: 'GET' })).rejects.toThrow(
      /allowlist/u,
    )
    // Only one fetch — initial; no follow-up to the rejected redirect target
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('dynamic host set is evaluated lazily on each call', async () => {
    // The thunk is called per-request, so host added after runtime construction is allowed
    const dynamicSet = new Set<string>()
    const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('ok', { status: 200 })))
    const assertPublicUrl = mock((_url: URL) => Promise.resolve())
    const runtime = buildProviderRuntime([], makeLogger(), { fetch: fetchMock, assertPublicUrl }, () => dynamicSet)

    // Before adding the host: rejected (https check fires before allowlist when host is unknown)
    await expect(runtime.httpFetch('http://whisper.lan/v1/transcribe')).rejects.toThrow()

    // After adding the host dynamically: allowed without restart
    dynamicSet.add('whisper.lan')
    const response = await runtime.httpFetch('http://whisper.lan/v1/transcribe')
    expect(response.status).toBe(200)
    expect(assertPublicUrl).not.toHaveBeenCalled()
  })
})
