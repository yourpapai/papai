// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, mock, test } from 'bun:test'

import { finishSessionTool, reviewPrTool, startSessionTool } from '../../../plugins/acp/tools.js'

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
  codingSecrets: { resolve(): Record<string, string> | null; resolveForgeToken(): string | null }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
  }
}

function ctx(
  resolve: () => Record<string, string> | null,
  resolveForgeToken: () => string | null = (): null => null,
): FakeRuntimeContext {
  return {
    storageContextId: 'pi:telegram:ctx:u1',
    adminConfig: ADMIN,
    kv: KV,
    codingSecrets: { resolve, resolveForgeToken },
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

// --- review_pr ---

test('review_pr refuses when no credentials are configured', async () => {
  const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
  const tool = reviewPrTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prNumber: 42 },
    ctx((): null => null),
    {},
  )
  expect(asRecord(res)['error']).toBe('not_configured')
  expect(httpFetch).not.toHaveBeenCalled()
})

test('review_pr includes resolved secrets in the POST body', async () => {
  let capturedInit: RequestInit | undefined
  const httpFetch: HttpFetch = (_url, init) => {
    capturedInit = init
    return Promise.resolve(jsonResponse({ id: 'r1', status: 'queued' }, 202))
  }
  const tool = reviewPrTool(httpFetch)
  await tool.execute(
    { project: 'demo', prNumber: 42 },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-2' }),
      (): string => 'ghp_forge',
    ),
    {},
  )
  expect(asRecord(parsedBody(capturedInit))['secrets']).toEqual({ ANTHROPIC_API_KEY: 'sk-2' })
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

// --- review_pr forge pre-flight + inject ---

test('review_pr refuses when no forge token', async () => {
  const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
  const tool = reviewPrTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prNumber: 42 },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): null => null,
    ),
    {},
  )
  expect(asRecord(res)['error']).toBe('not_configured')
  expect(httpFetch).not.toHaveBeenCalled()
})

test('review_pr includes forgeToken in body when present', async () => {
  let capturedInit: RequestInit | undefined
  const httpFetch: HttpFetch = (_url, init) => {
    capturedInit = init
    return Promise.resolve(jsonResponse({ id: 'r2', status: 'queued' }, 202))
  }
  const tool = reviewPrTool(httpFetch)
  await tool.execute(
    { project: 'demo', prNumber: 42 },
    ctx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): string => 'ghp_forge',
    ),
    {},
  )
  expect(asRecord(parsedBody(capturedInit))['forgeToken']).toBe('ghp_forge')
})
