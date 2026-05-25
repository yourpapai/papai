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
})
