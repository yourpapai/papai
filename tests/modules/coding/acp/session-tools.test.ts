// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { writeRecord } from '../../../../src/modules/coding/acp/history.js'
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  listSessionsTool,
  sessionStatusTool,
  startSessionTool,
} from '../../../../src/modules/coding/acp/session-tools.js'
import type { RuntimeContext } from '../../../../src/modules/coding/acp/tools.js'
import { jsonResponse, options, runtimeCtx, runtimeCtxWithKv } from './support.js'

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

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((row: unknown): Record<string, unknown> => asRecord(row)) : []
}

function readStoredRecord(store: Map<string, string>, sessionId: string): Record<string, unknown> {
  const raw = store.get(`session:${sessionId}`)
  const parsed: unknown = raw === undefined ? {} : JSON.parse(raw)
  return asRecord(parsed)
}

// --- start_session ---

describe('acp start_session tool', () => {
  test('injects context, POSTs /sessions with projectSpec, records kv', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-1', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const result = await startSessionTool(httpFetch).execute(
      { project: 'demo', prompt: 'do it' },
      runtimeCtxWithKv(store),
      options(),
    )
    expect(capturedBody).toEqual({
      agent: 'claude-code-acp',
      contextId: 'ctx-1',
      prompt: 'do it',
      secrets: { ANTHROPIC_API_KEY: 'sk-test' },
      forgeToken: 'ghp-test',
      projectSpec: {
        name: 'demo',
        repoUrl: 'https://github.com/acme/demo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'claude',
      },
    })
    expect(result).toEqual({ id: 's-1', status: 'queued' })
    expect(store.get('session:s-1')).toBeDefined()
  })

  test('start_session writes a rich history record', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ id: 's-7', status: 'queued' }, 202))
    const store = new Map<string, string>()
    await startSessionTool(httpFetch).execute(
      { project: 'demo', prompt: 'Add a health check\nmore detail' },
      runtimeCtxWithKv(store),
      options(),
    )
    const rec = readStoredRecord(store, 's-7')
    expect(rec['project']).toBe('demo')
    expect(rec['title']).toBe('Add a health check')
  })

  test('records shareToken/transcriptUrl from the magi response', async () => {
    const httpFetch: HttpFetch = () =>
      Promise.resolve(
        jsonResponse({ id: 'sess-9', shareToken: 'tok_z', transcriptUrl: 'https://papai.example/t/tok_z' }, 202),
      )
    const store = new Map<string, string>()
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, runtimeCtxWithKv(store), options())
    const rec = readStoredRecord(store, 'sess-9')
    expect(rec['shareToken']).toBe('tok_z')
    expect(rec['transcriptUrl']).toBe('https://papai.example/t/tok_z')
  })

  test('prNumber forwarded to POST /sessions body and recorded', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-pr', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    await startSessionTool(httpFetch).execute(
      { project: 'demo', prompt: 'review it', prNumber: 42 },
      runtimeCtxWithKv(store),
      options(),
    )
    expect(asRecord(capturedBody)['prNumber']).toBe(42)
    const rec = readStoredRecord(store, 's-pr')
    expect(rec['prNumber']).toBe(42)
  })

  test('explicit agent forwarded', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-2', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    await startSessionTool(httpFetch).execute(
      { project: 'demo', prompt: 'do it', agent: 'opencode' },
      runtimeCtxWithKv(store),
      options(),
    )
    expect(asRecord(capturedBody)['agent']).toBe('opencode')
  })

  test('unknown project returns not_found without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const emptyCodingRepos = {
      list: (): { name: string; baseBranch: string }[] => [],
      get: (_name: string): null => null,
    }
    const result = await startSessionTool(httpFetch).execute(
      { project: 'unknown', prompt: 'do it' },
      runtimeCtxWithKv(store, undefined, emptyCodingRepos),
      options(),
    )
    expect(result).toEqual({
      error: 'not_found',
      message: 'No repository named "unknown". Add it in settings → Repositories.',
    })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('missing project/prompt returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const result = await startSessionTool(httpFetch).execute({ project: 'demo' }, runtimeCtxWithKv(store), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'project and prompt are required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const result = await startSessionTool(httpFetch).execute(
      { project: 'demo', prompt: 'do it' },
      runtimeCtxWithKv(store, () => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('self-hosted repo without a configured forge returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const selfHostedRepos = {
      list: (): { name: string; baseBranch: string }[] => [{ name: 'demo', baseBranch: 'main' }],
      get: (_name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } => ({
        name: 'demo',
        repoUrl: 'https://gl.corp.com/acme/demo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
    }
    const result = await startSessionTool(httpFetch).execute(
      { project: 'demo', prompt: 'do it' },
      runtimeCtxWithKv(store, undefined, selfHostedRepos),
      options(),
    )
    expect(asRecord(result)['error']).toBe('not_configured')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('self-hosted repo WITH a configured forge proceeds to POST /sessions', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-sh', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const selfHostedRepos = {
      list: (): { name: string; baseBranch: string }[] => [{ name: 'demo', baseBranch: 'main' }],
      get: (_name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } => ({
        name: 'demo',
        repoUrl: 'https://gl.corp.com/acme/demo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      }),
    }
    const ctx: RuntimeContext = {
      ...runtimeCtxWithKv(store, undefined, selfHostedRepos),
      codingSecrets: {
        resolve: (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        resolveForgeToken: (): string => 'glpat-test',
        resolveAgent: (): null => null,
        resolveForge: (): { kind: 'gitlab'; apiBaseUrl: string } => ({
          kind: 'gitlab',
          apiBaseUrl: 'https://gl.corp.com/api/v4',
        }),
        resolveProviderHost: (): null => null,
        resolveModel: (): null => null,
        resolveMcp: (): null => null,
        resolveMcpToken: (): undefined => undefined,
      },
    }
    const result = await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, ctx, options())
    expect(asRecord(asRecord(capturedBody)['projectSpec'])['forge']).toEqual({
      kind: 'gitlab',
      apiBaseUrl: 'https://gl.corp.com/api/v4',
    })
    expect(result).toEqual({ id: 's-sh', status: 'queued' })
  })

  test('projectSpec includes forge when resolveForge returns a value', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-forge', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const ctxWithForge: RuntimeContext = {
      ...runtimeCtxWithKv(store),
      codingSecrets: {
        resolve: (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        resolveForgeToken: (): string => 'glpat-test',
        resolveAgent: (): null => null,
        resolveForge: (): { kind: 'gitlab'; apiBaseUrl: string } => ({
          kind: 'gitlab',
          apiBaseUrl: 'https://gl.corp.com/api/v4',
        }),
        resolveProviderHost: (): null => null,
        resolveModel: (): null => null,
        resolveMcp: (): null => null,
        resolveMcpToken: (): undefined => undefined,
      },
    }
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, ctxWithForge, options())
    expect(asRecord(asRecord(capturedBody)['projectSpec'])['forge']).toEqual({
      kind: 'gitlab',
      apiBaseUrl: 'https://gl.corp.com/api/v4',
    })
  })

  test('projectSpec.agent reflects the resolved agent from codingSecrets', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-3', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    // Override resolveAgent to return 'codex' to verify it flows into projectSpec.agent
    const ctxWithCodex: RuntimeContext = {
      ...runtimeCtxWithKv(store),
      codingSecrets: {
        resolve: (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        resolveForgeToken: (): string => 'ghp-test',
        resolveAgent: (): string => 'codex',
        resolveForge: (): null => null,
        resolveProviderHost: (): null => null,
        resolveModel: (): null => null,
        resolveMcp: (): null => null,
        resolveMcpToken: (): undefined => undefined,
      },
    }
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, ctxWithCodex, options())
    expect(asRecord(asRecord(capturedBody)['projectSpec'])['agent']).toBe('codex')
  })

  test('projectSpec includes providerHost when resolveProviderHost returns a value', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-4', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const ctxWithProviderHost: RuntimeContext = {
      ...runtimeCtxWithKv(store),
      codingSecrets: {
        resolve: (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        resolveForgeToken: (): string => 'ghp-test',
        resolveAgent: (): null => null,
        resolveForge: (): null => null,
        resolveProviderHost: (): string => 'llm.corp.com',
        resolveModel: (): null => null,
        resolveMcp: (): null => null,
        resolveMcpToken: (): undefined => undefined,
      },
    }
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, ctxWithProviderHost, options())
    expect(asRecord(asRecord(capturedBody)['projectSpec'])['providerHost']).toBe('llm.corp.com')
  })

  test('projectSpec omits providerHost when resolveProviderHost returns null', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-5', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, runtimeCtxWithKv(store), options())
    expect(Object.keys(asRecord(asRecord(capturedBody)['projectSpec']))).not.toContain('providerHost')
  })

  test('projectSpec includes model when resolveModel returns a value', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-model', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const ctxWithModel: RuntimeContext = {
      ...runtimeCtxWithKv(store),
      codingSecrets: {
        resolve: (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        resolveForgeToken: (): string => 'ghp-test',
        resolveAgent: (): null => null,
        resolveForge: (): null => null,
        resolveProviderHost: (): null => null,
        resolveModel: (): string => 'claude-opus-4-5',
        resolveMcp: (): null => null,
        resolveMcpToken: (): undefined => undefined,
      },
    }
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, ctxWithModel, options())
    expect(asRecord(asRecord(capturedBody)['projectSpec'])['model']).toBe('claude-opus-4-5')
  })

  test('projectSpec includes mcp and POST body includes mcpToken when resolveMcp/resolveMcpToken return values', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-mcp', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const ctxWithMcp: RuntimeContext = {
      ...runtimeCtxWithKv(store),
      codingSecrets: {
        resolve: (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        resolveForgeToken: (): string => 'ghp-test',
        resolveAgent: (): null => null,
        resolveForge: (): null => null,
        resolveProviderHost: (): null => null,
        resolveModel: (): null => null,
        resolveMcp: (): { url: string; host: string; header: string; allowedHosts: string[] } => ({
          url: 'https://mcp.example.com/mcp',
          host: 'mcp.example.com',
          header: 'X-Mcp-Auth',
          allowedHosts: ['mcp.example.com'],
        }),
        resolveMcpToken: (): string => 'mcp-tok',
      },
    }
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, ctxWithMcp, options())
    expect(asRecord(asRecord(capturedBody)['projectSpec'])['mcp']).toEqual({
      url: 'https://mcp.example.com/mcp',
      host: 'mcp.example.com',
      header: 'X-Mcp-Auth',
      allowedHosts: ['mcp.example.com'],
    })
    expect(asRecord(capturedBody)['mcpToken']).toBe('mcp-tok')
  })

  test('projectSpec omits mcp and POST body omits mcpToken when resolveMcp returns null', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-nomcp', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    await startSessionTool(httpFetch).execute({ project: 'demo', prompt: 'do it' }, runtimeCtxWithKv(store), options())
    expect(Object.keys(asRecord(asRecord(capturedBody)['projectSpec']))).not.toContain('mcp')
    expect(Object.keys(asRecord(capturedBody))).not.toContain('mcpToken')
  })
})

// --- list_sessions / session_status ---

const doneListFetch: HttpFetch = (url) => {
  if (url.includes('/sessions?filter=done'))
    return Promise.resolve(
      jsonResponse([{ id: 's-7', project: 'demo', status: 'done', prUrl: 'https://github.com/a/b/pull/12' }], 200),
    )
  return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
}

describe('acp list_sessions tool', () => {
  test('filters to kv-known sessions only, default filter=active', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(
        jsonResponse([
          { id: 's-1', status: 'running' },
          { id: 's-2', status: 'running' },
        ]),
      )
    }
    const store = new Map<string, string>()
    store.set('session:s-1', '1')
    const result = await listSessionsTool(httpFetch).execute({}, runtimeCtxWithKv(store), options())
    expect(seenUrl).toContain('filter=active')
    expect(result).toEqual([{ id: 's-1', status: 'running' }])
  })

  test('explicit filter is forwarded in the URL', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(jsonResponse([]))
    }
    const store = new Map<string, string>()
    await listSessionsTool(httpFetch).execute({ filter: 'waiting' }, runtimeCtxWithKv(store), options())
    expect(seenUrl).toContain('filter=waiting')
  })

  test('invalid filter returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const store = new Map<string, string>()
    const result = await listSessionsTool(httpFetch).execute({ filter: 'bogus' }, runtimeCtxWithKv(store), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(result).toHaveProperty('message', expect.stringContaining('filter'))
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const store = new Map<string, string>()
    const result = await listSessionsTool(httpFetch).execute(
      {},
      runtimeCtxWithKv(store, () => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('merges local title and prNumber into magi rows', async () => {
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 's-7', { project: 'demo', title: 'Add a health check', createdAt: 'x' })
    const result = await listSessionsTool(doneListFetch).execute({ filter: 'done' }, runtimeCtxWithKv(store), options())
    const out = asRows(result)
    expect(out).toHaveLength(1)
    expect(out[0]!['title']).toBe('Add a health check')
    expect(out[0]!['prNumber']).toBe(12)
    const refreshed = readStoredRecord(store, 's-7')
    expect(refreshed['prNumber']).toBe(12)
  })

  test('includes transcriptUrl from the local record when present', async () => {
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 's-7', {
      project: 'demo',
      title: 'Add a health check',
      createdAt: 'x',
      transcriptUrl: 'https://papai.example/t/tok_z',
    })
    const result = await listSessionsTool(doneListFetch).execute({ filter: 'done' }, runtimeCtxWithKv(store), options())
    const out = asRows(result)
    expect(out).toHaveLength(1)
    expect(out[0]!['transcriptUrl']).toBe('https://papai.example/t/tok_z')
  })

  test('omits transcriptUrl when the local record has none', async () => {
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 's-7', { project: 'demo', title: 'Add a health check', createdAt: 'x' })
    const result = await listSessionsTool(doneListFetch).execute({ filter: 'done' }, runtimeCtxWithKv(store), options())
    const out = asRows(result)
    expect(out).toHaveLength(1)
    expect(out[0]).not.toHaveProperty('transcriptUrl')
  })
})

describe('acp session_status tool', () => {
  test('GETs /sessions/:id and returns the magi body', async () => {
    let seenUrl = ''
    const httpFetch: HttpFetch = (url) => {
      seenUrl = url
      return Promise.resolve(jsonResponse({ id: 's-1', status: 'running', output: 'done' }))
    }
    const result = await sessionStatusTool(httpFetch).execute({ sessionId: 's-1' }, runtimeCtx(), options())
    expect(seenUrl).toBe('http://magi:8787/sessions/s-1')
    expect(result).toEqual({ id: 's-1', status: 'running', output: 'done' })
  })

  test('missing sessionId returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await sessionStatusTool(httpFetch).execute({}, runtimeCtx(), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'sessionId is required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await sessionStatusTool(httpFetch).execute(
      { sessionId: 's-1' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

// --- finish_session / cancel_session / answer_permission ---

// Returns [fetch, postCallsRef] — fetch records calls to /permission into the postCallsRef array
// and routes GET /permissions → permissionsBody, POST /permission → { resolved: true }.
// Each call creates a fresh Response to avoid body-already-used errors on concurrent reads.
function makePermissionFetch(permissionsBody: unknown): [HttpFetch, Array<{ url: string; body: unknown }>] {
  const postCalls: Array<{ url: string; body: unknown }> = []
  const permissionsJson = JSON.stringify(permissionsBody)
  const routes: Array<readonly [string, (b: unknown) => Response]> = [
    [
      'http://magi:8787/sessions/s-1/permissions',
      (): Response => new Response(permissionsJson, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ],
    [
      'http://magi:8787/sessions/s-1/permission',
      (b: unknown): Response => {
        postCalls.push({ url: 'http://magi:8787/sessions/s-1/permission', body: b })
        return new Response('{"resolved":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    ],
  ]
  const routeMap = new Map(routes)
  const fetch: HttpFetch = (url: string, init?: RequestInit): Promise<Response> => {
    const body = parsedBody(init)
    const handler = routeMap.get(url)
    return Promise.resolve(handler ? handler(body) : jsonResponse(null, 404))
  }
  return [fetch, postCalls]
}

describe('acp finish_session tool', () => {
  test('POSTs /sessions/:id/finish with defaulted message and action=pr, returns magi body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const httpFetch: HttpFetch = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ merged: true }))
    }
    const result = await finishSessionTool(httpFetch).execute(
      { sessionId: 's-1', action: 'pr' },
      runtimeCtx(),
      options(),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://magi:8787/sessions/s-1/finish')
    expect(parsedBody(calls[0]!.init)).toEqual({
      message: 'Apply changes from magi coding session',
      action: 'pr',
      forgeToken: 'ghp-test',
    })
    expect(result).toEqual({ merged: true })
  })

  test('explicit message, title, body are forwarded', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const httpFetch: HttpFetch = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ merged: true }))
    }
    await finishSessionTool(httpFetch).execute(
      { sessionId: 's-1', action: 'pr', message: 'my commit', title: 'My PR', body: 'Some body text' },
      runtimeCtx(),
      options(),
    )
    expect(parsedBody(calls[0]!.init)).toEqual({
      message: 'my commit',
      action: 'pr',
      title: 'My PR',
      body: 'Some body text',
      forgeToken: 'ghp-test',
    })
  })

  test('missing sessionId returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await finishSessionTool(httpFetch).execute({ action: 'pr' }, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('action not in push|pr returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await finishSessionTool(httpFetch).execute(
      { sessionId: 's-1', action: 'squash' },
      runtimeCtx(),
      options(),
    )
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await finishSessionTool(httpFetch).execute(
      { sessionId: 's-1', action: 'push' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('acp cancel_session tool', () => {
  test('POSTs /sessions/:id/cancel and returns magi body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const httpFetch: HttpFetch = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse({ cancelled: true }))
    }
    const result = await cancelSessionTool(httpFetch).execute({ sessionId: 's-1' }, runtimeCtx(), options())
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://magi:8787/sessions/s-1/cancel')
    expect(result).toEqual({ cancelled: true })
  })

  test('missing sessionId returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await cancelSessionTool(httpFetch).execute({}, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await cancelSessionTool(httpFetch).execute(
      { sessionId: 's-1' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('acp answer_permission tool', () => {
  test('GETs pending permissions and POSTs a decision for each toolCallId', async () => {
    const [httpFetch, postCalls] = makePermissionFetch([
      { toolCallId: 't1', title: 'x' },
      { toolCallId: 't2', title: 'y' },
    ])
    const result = await answerPermissionTool(httpFetch).execute(
      { sessionId: 's-1', decision: 'allow' },
      runtimeCtx(),
      options(),
    )
    expect(postCalls).toHaveLength(2)
    expect(postCalls[0]!.url).toBe('http://magi:8787/sessions/s-1/permission')
    expect(postCalls[1]!.url).toBe('http://magi:8787/sessions/s-1/permission')
    expect(postCalls[0]!.body).toEqual({ toolCallId: 't1', decision: 'allow' })
    expect(postCalls[1]!.body).toEqual({ toolCallId: 't2', decision: 'allow' })
    expect(result).toEqual({ resolved: 2, decision: 'allow' })
  })

  test('no pending permissions returns resolved:0 without POSTing', async () => {
    const [httpFetch, postCalls] = makePermissionFetch([])
    const result = await answerPermissionTool(httpFetch).execute(
      { sessionId: 's-1', decision: 'allow' },
      runtimeCtx(),
      options(),
    )
    expect(postCalls).toHaveLength(0)
    expect(result).toEqual({ resolved: 0, message: 'no pending permission requests' })
  })

  test('missing sessionId returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await answerPermissionTool(httpFetch).execute({ decision: 'allow' }, runtimeCtx(), options())
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('bad decision returns invalid_input, httpFetch not called', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await answerPermissionTool(httpFetch).execute(
      { sessionId: 's-1', decision: 'maybe' },
      runtimeCtx(),
      options(),
    )
    expect(result).toHaveProperty('error', 'invalid_input')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const result = await answerPermissionTool(httpFetch).execute(
      { sessionId: 's-1', decision: 'deny' },
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

// --- coding secrets / forge token injection (direct factory calls with a locally-shaped ctx) ---

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

function secretsCtx(
  resolve: () => Record<string, string> | null,
  resolveForgeToken: () => string | null = (): null => null,
  resolveAgent: () => string | null = (): null => null,
  resolveForge: () => { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null = (): null => null,
  resolveProviderHost: () => string | null = (): null => null,
  resolveModel: () => string | null = (): null => null,
  resolveMcp: () => { url: string; host: string; header: string; allowedHosts: string[] } | null = (): null => null,
  resolveMcpToken: () => string | undefined = (): undefined => undefined,
): RuntimeContext {
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

test('start_session refuses when no credentials are configured', async () => {
  const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
  const tool = startSessionTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prompt: 'hi' },
    secretsCtx((): null => null),
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
    secretsCtx((): null => null),
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
    secretsCtx((): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' })),
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
    secretsCtx(
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
    secretsCtx(
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
    secretsCtx(
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
    secretsCtx(
      (): Record<string, string> => ({ ANTHROPIC_API_KEY: 'sk-1' }),
      (): string => 'ghp_forge',
    ),
    {},
  )
  expect(asRecord(parsedBody(capturedInit))['forgeToken']).toBe('ghp_forge')
})
