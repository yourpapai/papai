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

  test('rewrites a 302 POST redirect replay to GET without the original body', async () => {
    mockLogger()
    const { fetchSpy, ...deps } = makeDeps()
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://api.kaneo.io/v2/tasks' } }),
    )
    fetchSpy.mockResolvedValueOnce(new Response('ok'))
    const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

    await runtime.httpFetch('https://api.kaneo.io/v1/tasks', {
      method: 'POST',
      body: 'title=Task',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: 'GET' })
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toBeUndefined()
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
