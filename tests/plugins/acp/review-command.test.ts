// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { AuthorizationResult } from '../../../src/chat/authorization-types.js'
import type { IncomingMessage, ReplyFn } from '../../../src/chat/types.js'
import { activate, jsonResponse, options, runtimeCtxWithKv } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function stubMessage(): IncomingMessage {
  return {
    user: { id: 'u-1', username: 'tester', isAdmin: false },
    contextId: 'ctx-1',
    contextType: 'dm',
    isMentioned: false,
    text: '/acp',
    platformInstanceId: 'pi-1',
  }
}

function stubAuth(): AuthorizationResult {
  return { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'ctx-1' }
}

function stubReply(replies: string[]): ReplyFn {
  const push = (s: string): Promise<void> => {
    replies.push(s)
    return Promise.resolve()
  }
  return {
    text: push,
    formatted: push,
    typing: (): void => {},
    buttons: (): Promise<undefined> => Promise.resolve(undefined),
  }
}

function bodyString(init: RequestInit | undefined): string {
  const b = init?.body
  return typeof b === 'string' ? b : ''
}

describe('acp review_pr tool', () => {
  test('injects contextId, POSTs /reviews with projectSpec, records kv', async () => {
    let capturedUrl = ''
    let capturedBody: unknown = null
    const httpFetch: HttpFetch = (url, init) => {
      capturedUrl = url
      capturedBody = JSON.parse(bodyString(init))
      return Promise.resolve(jsonResponse({ id: 'r-1', status: 'queued' }, 202))
    }
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('review_pr')!
      .execute({ project: 'demo', prNumber: 42 }, runtimeCtxWithKv(store), options())
    expect(capturedUrl).toBe('http://magi:8787/reviews')
    expect(capturedBody).toEqual({
      prNumber: 42,
      contextId: 'ctx-1',
      secrets: { ANTHROPIC_API_KEY: 'sk-test' },
      forgeToken: 'ghp-test',
      projectSpec: {
        name: 'demo',
        repoUrl: 'https://github.com/acme/demo.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      },
    })
    expect(result).toEqual({ id: 'r-1', status: 'queued' })
    expect(store.get('session:r-1')).toBeDefined()
  })

  test('unknown project returns not_found without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const emptyCodingRepos = {
      list: (): { name: string; baseBranch: string }[] => [],
      get: (_name: string): null => null,
    }
    const result = await tools
      .get('review_pr')!
      .execute({ project: 'unknown', prNumber: 42 }, runtimeCtxWithKv(store, undefined, emptyCodingRepos), options())
    expect(result).toEqual({
      error: 'not_found',
      message: 'No repository named "unknown". Add it in settings → Repositories.',
    })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('missing project returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('review_pr')!.execute({ prNumber: 42 }, runtimeCtxWithKv(store), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'project and a positive prNumber are required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('prNumber=0 returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('review_pr')!
      .execute({ project: 'demo', prNumber: 0 }, runtimeCtxWithKv(store), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'project and a positive prNumber are required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('prNumber=-1 returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools
      .get('review_pr')!
      .execute({ project: 'demo', prNumber: -1 }, runtimeCtxWithKv(store), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'project and a positive prNumber are required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('missing prNumber returns invalid_input without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('review_pr')!.execute({ project: 'demo' }, runtimeCtxWithKv(store), options())
    expect(result).toEqual({ error: 'invalid_input', message: 'project and a positive prNumber are required' })
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('not configured returns not_configured without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse({})))
    const store = new Map<string, string>()
    const { tools } = activate(httpFetch)
    const result = await tools.get('review_pr')!.execute(
      { project: 'demo', prNumber: 42 },
      runtimeCtxWithKv(store, () => undefined),
      options(),
    )
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('acp /acp command', () => {
  test('replies with non-empty help text mentioning sessions', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({}))
    const { command } = activate(httpFetch)
    expect(command).toBeDefined()
    const replies: string[] = []
    await command!.execute(stubMessage(), stubReply(replies), stubAuth())
    expect(replies).toHaveLength(1)
    expect(replies[0]!.length).toBeGreaterThan(0)
    expect(replies[0]!.toLowerCase()).toContain('session')
  })
})

describe('acp prompt fragment', () => {
  test('registers acp-hint fragment with non-empty content under 2000 chars', () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({}))
    const { fragment } = activate(httpFetch)
    expect(fragment).toBeDefined()
    expect(fragment!.name).toBe('acp-hint')
    expect(typeof fragment!.content).toBe('string')
    expect(String(fragment!.content).length).toBeGreaterThan(0)
    expect(String(fragment!.content).length).toBeLessThan(2000)
  })
})
