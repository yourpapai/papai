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
  test('list_projects returns the catalogue without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), options())
    expect(result).toEqual([{ name: 'demo', baseBranch: 'main' }])
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('list_projects returns empty list when no repos configured', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const { tools } = activate(httpFetch)
    const emptyCodingRepos = {
      list: (): { name: string; baseBranch: string }[] => [],
      get: (_name: string): null => null,
    }
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(undefined, emptyCodingRepos), options())
    expect(result).toEqual([])
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('list_agents GETs /agents', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([{ name: 'claude-code-acp' }])))
    const { tools } = activate(httpFetch)
    const result = await tools.get('list_agents')!.execute({}, runtimeCtx(), options())
    expect(result).toEqual([{ name: 'claude-code-acp' }])
  })

  test('list_agents uses bearer auth', async () => {
    let seenAuth = ''
    const httpFetch: HttpFetch = (_url, init) => {
      seenAuth = getAuthHeader(init)
      return Promise.resolve(jsonResponse([]))
    }
    const { tools } = activate(httpFetch)
    await tools.get('list_agents')!.execute({}, runtimeCtx(), options())
    expect(seenAuth).toBe('Bearer tok')
  })
})
