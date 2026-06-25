// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { activate, jsonResponse, options, runtimeCtxWithKv } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function bodyString(init: RequestInit | undefined): string {
  const b = init?.body
  return typeof b === 'string' ? b : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

describe('acp start_session tool', () => {
  test('injects context, POSTs /sessions, records kv', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-1', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('start_session')!
      .execute({ project: 'demo', prompt: 'do it' }, runtimeCtxWithKv(store), options())
    expect(capturedBody).toEqual({
      project: 'demo',
      agent: 'claude-code-acp',
      contextId: 'ctx-1',
      prompt: 'do it',
      secrets: { ANTHROPIC_API_KEY: 'sk-test' },
    })
    expect(result).toEqual({ id: 's-1', status: 'queued' })
    expect(store.get('session:s-1')).toBeDefined()
  })

  test('explicit agent forwarded', async () => {
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (_url, init) => {
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 's-2', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    await tools
      .get('start_session')!
      .execute({ project: 'demo', prompt: 'do it', agent: 'opencode' }, runtimeCtxWithKv(store), options())
    expect(asRecord(capturedBody)['agent']).toBe('opencode')
  })

  test('missing project/prompt returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('start_session')!.execute({ project: 'demo' }, runtimeCtxWithKv(store), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'project and prompt are required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('start_session')!.execute(
      { project: 'demo', prompt: 'do it' },
      runtimeCtxWithKv(store, () => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})
