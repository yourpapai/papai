// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { activate, jsonResponse, options, runtimeCtx } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function getAuthHeader(init: RequestInit | undefined): string {
  return new Headers(init?.headers).get('authorization') ?? ''
}

describe('acp read tools', () => {
  test('list_projects GETs /projects with bearer auth', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const httpFetch: HttpFetch = (url, init) => {
      seenUrl = url
      seenAuth = getAuthHeader(init)
      return Promise.resolve(
        jsonResponse([{ name: 'demo', baseBranch: 'main', forgeKind: 'github', agent: 'claude-code-acp' }]),
      )
    }
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), options())
    expect(seenUrl).toBe('http://magi:8787/projects')
    expect(seenAuth).toBe('Bearer tok')
    expect(result).toEqual([{ name: 'demo', baseBranch: 'main', forgeKind: 'github', agent: 'claude-code-acp' }])
  })

  test('list_agents GETs /agents', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([{ name: 'claude-code-acp' }])))
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_agents')!.execute({}, runtimeCtx(), options())
    expect(result).toEqual([{ name: 'claude-code-acp' }])
  })

  test('returns not_configured when admin config is missing', async () => {
    const { tools } = activate(mock())
    const result = await tools.get('list_projects')!.execute(
      {},
      runtimeCtx(() => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
  })

  test('surfaces a magi error response', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ error: 'boom' }, 500))
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), options())
    expect(result).toEqual({ error: 'magi_error', status: 500, body: { error: 'boom' } })
  })
})
