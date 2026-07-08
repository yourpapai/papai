// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, mock, test } from 'bun:test'

import { finishSessionTool, startSessionTool } from '../../../plugins/acp/session-tools.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function bodyString(init: RequestInit | undefined): string {
  const b = init?.body
  return typeof b === 'string' ? b : ''
}

function parsedBody(init: RequestInit | undefined): unknown {
  const s = bodyString(init)
  return s === '' ? null : JSON.parse(s)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

const ADMIN = {
  get: (k: string): string | undefined =>
    k === 'magi_base_url' ? 'http://magi.local' : k === 'magi_token' ? 'tok' : undefined,
}
const KV = {
  get: (): undefined => undefined,
  set: (): void => {},
  delete: (): void => {},
  list: (): [] => [],
}

const DEMO_REPO = {
  name: 'demo',
  repoUrl: 'https://github.com/acme/demo.git',
  baseBranch: 'main',
  permissionPreset: 'cautious',
}

type FakeRuntimeContext = {
  storageContextId: string
  adminConfig: typeof ADMIN
  kv: typeof KV
  codingSecrets: {
    resolve(): Record<string, string> | null
    resolveForgeToken(): string | null
    resolveAgent(): string | null
    resolveForge(): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null
    resolveProviderHost(): string | null
    resolveModel(): string | null
    resolveMcp(): { url: string; host: string; header: string; allowedHosts: string[] } | null
    resolveMcpToken(): string | undefined
  }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
  }
}

function ctx(
  resolve: () => Record<string, string> | null,
  resolveForgeToken: () => string | null = (): null => null,
  resolveAgent: () => string | null = (): null => null,
  resolveForge: () => { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null = (): null => null,
  resolveProviderHost: () => string | null = (): null => null,
  resolveModel: () => string | null = (): null => null,
  resolveMcp: () => { url: string; host: string; header: string; allowedHosts: string[] } | null = (): null => null,
  resolveMcpToken: () => string | undefined = (): undefined => undefined,
): FakeRuntimeContext {
  return {
    storageContextId: 'pi:telegram:ctx:u1',
    adminConfig: ADMIN,
    kv: KV,
    codingSecrets: {
      resolve,
      resolveForgeToken,
      resolveAgent,
      resolveForge,
      resolveProviderHost,
      resolveModel,
      resolveMcp,
      resolveMcpToken,
    },
    codingRepos: {
      list: () => [{ name: 'demo', baseBranch: 'main' }],
      get: (name: string) => (name === 'demo' ? DEMO_REPO : null),
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// --- start_session ---

test('start_session refuses when no credentials are configured', async () => {
  const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
  const tool = startSessionTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx((): null => null),
    {},
  )
  expect(asRecord(res)['error']).toBe('not_configured')
  expect(httpFetch).not.toHaveBeenCalled()
})

test('start_session not_configured message tells the acting user to set up their own credentials', async () => {
  const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
  const tool = startSessionTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx((): null => null),
    {},
  )
  const msg = String(asRecord(res)['message'])
  expect(msg).toContain("You haven't set up your coding credentials")
  expect(msg).toContain('settings')
})

test('start_session includes resolved secrets in the POST body', async () => {
  let capturedInit: RequestInit | undefined
  const httpFetch: HttpFetch = (_url, init) => {
    capturedInit = init
    return Promise.resolve(jsonResponse({ id: 's1', status: 'queued' }, 202))
  }
  const tool = startSessionTool(httpFetch)
  await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx((): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' })),
    {},
  )
  expect(asRecord(parsedBody(capturedInit))['secrets']).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})

// --- start_session forge token (optional injection) ---

test('start_session includes forgeToken in body when present', async () => {
  let capturedInit: RequestInit | undefined
  const httpFetch: HttpFetch = (_url, init) => {
    capturedInit = init
    return Promise.resolve(jsonResponse({ id: 's2', status: 'queued' }, 202))
  }
  const tool = startSessionTool(httpFetch)
  await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): string => 'ghp_forge',
    ),
    {},
  )
  expect(asRecord(parsedBody(capturedInit))['forgeToken']).toBe('ghp_forge')
})

test('start_session proceeds without forgeToken when null (no refusal)', async () => {
  let capturedInit: RequestInit | undefined
  const httpFetch: HttpFetch = (_url, init) => {
    capturedInit = init
    return Promise.resolve(jsonResponse({ id: 's3', status: 'queued' }, 202))
  }
  const tool = startSessionTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): null => null,
    ),
    {},
  )
  expect(asRecord(res)['error']).toBeUndefined()
  expect(Object.prototype.hasOwnProperty.call(asRecord(parsedBody(capturedInit)), 'forgeToken')).toBe(false)
})

// --- finish_session forge pre-flight + inject ---

test('finish_session refuses when no forge token', async () => {
  const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
  const tool = finishSessionTool(httpFetch)
  const res = await tool.execute(
    { sessionId: 'sess-1', action: 'push' },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): null => null,
    ),
    {},
  )
  expect(asRecord(res)['error']).toBe('not_configured')
  expect(httpFetch).not.toHaveBeenCalled()
})

test('finish_session includes forgeToken in body when present', async () => {
  let capturedInit: RequestInit | undefined
  const httpFetch: HttpFetch = (_url, init) => {
    capturedInit = init
    return Promise.resolve(jsonResponse({ status: 'pushed' }, 200))
  }
  const tool = finishSessionTool(httpFetch)
  await tool.execute(
    { sessionId: 'sess-1', action: 'push' },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): string => 'ghp_forge',
    ),
    {},
  )
  expect(asRecord(parsedBody(capturedInit))['forgeToken']).toBe('ghp_forge')
})
