// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitLabClient } from '../../plugins/mcp-gitlab/client.js'

interface Captured {
  url: string
  method: string | undefined
  body: unknown
}

function captureFetch(responseBody: unknown): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    captured.push({ url, method: init?.method, body: rawBody === undefined ? undefined : JSON.parse(rawBody) })
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 201 }))
  }
  return { httpFetch, captured }
}

function client(httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>): GitLabClient {
  return new GitLabClient({ baseUrl: 'https://gl.example.com', token: 'tok', httpFetch })
}

describe('GitLabClient writes', () => {
  test('postComment POSTs a note and returns the noteId', async () => {
    const { httpFetch, captured } = captureFetch({ id: 7, body: 'hi' })
    const out = await client(httpFetch).postComment('group/proj', '42', 'hi')
    expect(out).toEqual({ noteId: 7 })
    expect(captured[0]?.method).toBe('POST')
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42/notes')
    expect(captured[0]?.body).toEqual({ body: 'hi' })
  })

  test('createDiscussion POSTs a discussion and returns discussionId + noteId', async () => {
    const { httpFetch, captured } = captureFetch({ id: 'abc123', notes: [{ id: 9 }] })
    const out = await client(httpFetch).createDiscussion('group/proj', '42', 'thread start')
    expect(out).toEqual({ discussionId: 'abc123', noteId: 9 })
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42/discussions')
    expect(captured[0]?.body).toEqual({ body: 'thread start' })
  })

  test('updateMr PUTs only provided fields (targetBranch -> target_branch) and shapes the MR', async () => {
    const { httpFetch, captured } = captureFetch({ title: 'New', state: 'opened' })
    const out = await client(httpFetch).updateMr('group/proj', '42', { title: 'New', targetBranch: 'main' })
    expect(out).toEqual({ title: 'New', state: 'opened' })
    expect(captured[0]?.method).toBe('PUT')
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42')
    expect(captured[0]?.body).toEqual({ title: 'New', target_branch: 'main' })
  })

  test('setMrState PUTs state_event and shapes the MR', async () => {
    const { httpFetch, captured } = captureFetch({ title: 'X', state: 'closed' })
    const out = await client(httpFetch).setMrState('group/proj', '42', 'close')
    expect(out).toEqual({ title: 'X', state: 'closed' })
    expect(captured[0]?.body).toEqual({ state_event: 'close' })
  })

  test('a non-ok write surfaces a clean error', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{}', { status: 403 }))
    await expect(client(httpFetch).postComment('group/proj', '42', 'hi')).rejects.toThrow(/GitLab API 403/u)
  })
})
