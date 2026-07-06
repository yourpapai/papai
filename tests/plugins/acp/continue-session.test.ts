// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { writeRecord } from '../../../plugins/acp/history.js'
import { activate, jsonResponse, options, runtimeCtxWithKv } from './support.js'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

function readStoredRecord(store: Map<string, string>, sessionId: string): Record<string, unknown> {
  const raw = store.get(`session:${sessionId}`)
  const parsed: unknown = raw === undefined ? {} : JSON.parse(raw)
  return asRecord(parsed)
}

function followUpOnlyFetch(parentId: string, childBody: unknown, calls: string[]): FetchFn {
  return (url: string): Promise<Response> => {
    calls.push(url)
    return url.endsWith(`/sessions/${parentId}/follow-up`)
      ? Promise.resolve(jsonResponse(childBody, 202))
      : Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
  }
}

function alwaysOkFetch(): FetchFn {
  return (): Promise<Response> => Promise.resolve(jsonResponse({}, 200))
}

function readInitBody(init: RequestInit | undefined): Record<string, unknown> {
  if (init === undefined || typeof init.body !== 'string') return {}
  const parsed: unknown = JSON.parse(init.body)
  return asRecord(parsed)
}

function capturingFollowUpFetch(
  parentId: string,
  childBody: unknown,
  sink: { body: Record<string, unknown> },
): FetchFn {
  return (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.endsWith(`/sessions/${parentId}/follow-up`))
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    sink.body = readInitBody(init)
    return Promise.resolve(jsonResponse(childBody, 202))
  }
}

function doneListThenFollowUpFetch(parentId: string, doneList: unknown[], childBody: unknown): FetchFn {
  return (url: string): Promise<Response> => {
    if (url.includes('/sessions?filter=done')) return Promise.resolve(jsonResponse(doneList, 200))
    return url.endsWith(`/sessions/${parentId}/follow-up`)
      ? Promise.resolve(jsonResponse(childBody, 202))
      : Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
  }
}

describe('acp continue_session tool', () => {
  test('continues by sessionId: POSTs follow-up and records the child', async () => {
    const calls: string[] = []
    const httpFetch = followUpOnlyFetch('p1', { id: 'c1', status: 'queued', parentSessionId: 'p1' }, calls)
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 'p1', {
      project: 'demo',
      title: 'first',
      createdAt: '2026-07-01T00:00:00.000Z',
      prUrl: 'https://github.com/a/b/pull/5',
    })
    const { tools } = activate(httpFetch)
    const res = asRecord(
      await tools
        .get('continue_session')!
        .execute({ sessionId: 'p1', prompt: 'fix tests' }, runtimeCtxWithKv(store), options()),
    )
    expect(res['id']).toBe('c1')
    expect(calls.some((u) => u.endsWith('/sessions/p1/follow-up'))).toBe(true)
    const child = readStoredRecord(store, 'c1')
    expect(child['parentSessionId']).toBe('p1')
    expect(child['prUrl']).toBe('https://github.com/a/b/pull/5')
  })

  test('forwards the current thread contextId on the follow-up request', async () => {
    const sink = { body: {} as Record<string, unknown> }
    const httpFetch = capturingFollowUpFetch('p1', { id: 'c1', status: 'queued', parentSessionId: 'p1' }, sink)
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 'p1', { project: 'demo', title: 't', createdAt: 'x' })
    const { tools } = activate(httpFetch)
    await tools.get('continue_session')!.execute({ sessionId: 'p1', prompt: 'go' }, runtimeCtxWithKv(store), options())
    // storageContextId in the test runtime context is 'ctx-1' (the current thread).
    expect(sink.body['contextId']).toBe('ctx-1')
  })

  test('refuses not_configured when the forge token is missing', async () => {
    const httpFetch = alwaysOkFetch()
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 'p1', { project: 'demo', title: 't', createdAt: 'x' })
    const { tools } = activate(httpFetch)
    const ctx = runtimeCtxWithKv(store)
    ctx.codingSecrets.resolveForgeToken = (): string | null => null
    const res = asRecord(await tools.get('continue_session')!.execute({ sessionId: 'p1', prompt: 'x' }, ctx, options()))
    expect(res['error']).toBe('not_configured')
  })

  test('resolves a prNumber to a known session id via the done list', async () => {
    const httpFetch = doneListThenFollowUpFetch(
      'p9',
      [{ id: 'p9', project: 'demo', prUrl: 'https://github.com/a/b/pull/42', status: 'done' }],
      { id: 'c9', status: 'queued', parentSessionId: 'p9' },
    )
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 'p9', { project: 'demo', title: 't', createdAt: 'x' })
    const { tools } = activate(httpFetch)
    const res = asRecord(
      await tools
        .get('continue_session')!
        .execute({ prNumber: 42, project: 'demo', prompt: 'go' }, runtimeCtxWithKv(store), options()),
    )
    expect(res['id']).toBe('c9')
  })
})
