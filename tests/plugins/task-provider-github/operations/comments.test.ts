// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../../plugins/task-provider-github/client.js'
import {
  githubCreateTaskComment,
  githubDeleteTaskComment,
  githubListTaskComments,
  githubUpdateTaskComment,
} from '../../../../plugins/task-provider-github/operations/comments.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const config: GitHubConfig = { baseUrl: '', repo: 'octocat/Hello-World', token: 'test-token' }

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const noContentResponse = (): Response => new Response(null, { status: 204 })

type CapturedRequest = Readonly<{ url: URL; method: string; body: Record<string, unknown> }>

const parseBodyText = (bodyText: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(bodyText)
  if (typeof parsed !== 'object' || parsed === null) return {}
  const record: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) record[key] = value
  return record
}

const sequenceResponder =
  (responses: Array<{ data: unknown; status?: number }>) =>
  (call: number): { data: unknown; status?: number } =>
    responses[call] ?? { data: [] }

const captureRequests = (
  sink: CapturedRequest[],
  respond: (call: number) => { data: unknown; status?: number },
): { fetches: () => number; handler: (url: string, init: RequestInit) => Promise<Response> } => {
  let call = 0
  return {
    fetches: (): number => call,
    handler: (url: string, init: RequestInit): Promise<Response> => {
      const current = call
      call += 1
      const bodyText = typeof init.body === 'string' ? init.body : undefined
      const response = respond(current)
      sink.push({
        url: new URL(url),
        method: init.method ?? '',
        body: bodyText === undefined ? {} : parseBodyText(bodyText),
      })
      // GitHub answers DELETE with 204 and no body at all.
      if (response.status === 204) return Promise.resolve(noContentResponse())
      return Promise.resolve(jsonResponse(response.data, response.status ?? 200))
    },
  }
}

const user = {
  login: 'octocat',
  id: 583231,
  avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
  html_url: 'https://github.com/octocat',
  type: 'User',
}

const commentResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1,
  body: 'Me too',
  user,
  created_at: '2011-04-14T16:00:49Z',
  updated_at: '2011-04-14T16:00:49Z',
  html_url: 'https://github.com/octocat/Hello-World/issues/1347#issuecomment-1',
  issue_url: 'https://api.github.com/repos/octocat/Hello-World/issues/1347',
  author_association: 'NONE',
  ...overrides,
})

const commentPage = (count: number, offset = 0): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, i) => commentResponse({ id: offset + i + 1, body: `Comment ${offset + i + 1}` }))

afterEach(() => {
  restoreFetch()
})

describe('githubListTaskComments', () => {
  test('GETs the issue comments path and normalizes results', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: commentPage(2) })).handler)
    const comments = await githubListTaskComments(config, '1347')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/comments')
    expect(comments).toHaveLength(2)
    expect(comments[0]?.id).toBe('1')
    expect(comments[0]?.author).toBe('octocat')
    expect(comments[0]?.createdAt).toBe('2011-04-14T16:00:49Z')
  })

  test('window spans pages: fetches until offset + limit, slices [offset, offset+limit)', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureRequests(calls, sequenceResponder([{ data: commentPage(100) }, { data: commentPage(30, 100) }])).handler,
    )
    const comments = await githubListTaskComments(config, '1347', { offset: 90, limit: 20 })
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/repos/octocat/Hello-World/issues/1347/comments',
      '/repos/octocat/Hello-World/issues/1347/comments',
    ])
    expect(calls[0]?.url.searchParams.get('page')).toBe('1')
    expect(calls[1]?.url.searchParams.get('page')).toBe('2')
    expect(calls[1]?.url.searchParams.get('per_page')).toBe('100')
    expect(comments).toHaveLength(20)
    expect(comments[0]?.id).toBe('91')
    expect(comments[19]?.id).toBe('110')
  })

  test('fetch window is bounded at offset + limit: a full page satisfies a small window', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: commentPage(100) })).handler)
    const comments = await githubListTaskComments(config, '1347', { offset: 5, limit: 10 })
    expect(calls).toHaveLength(1)
    expect(comments).toHaveLength(10)
    expect(comments[0]?.id).toBe('6')
    expect(comments[9]?.id).toBe('15')
  })

  test('author is undefined for a ghost commenter', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: [commentResponse({ id: 7, user: null })] })).handler)
    const comments = await githubListTaskComments(config, '1347')
    expect(comments[0]?.author).toBeUndefined()
  })

  test('404 classifies as task-not-found with the task id', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubListTaskComments(config, '1347').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'task-not-found')
    expect(caught.appError).toHaveProperty('taskId', '1347')
  })
})

describe('githubCreateTaskComment', () => {
  test('POSTs { body } to the issue comments path and returns the normalized comment', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: commentResponse(), status: 201 })).handler)
    const comment = await githubCreateTaskComment(config, '1347', 'Me too')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/comments')
    expect(calls[0]?.body).toEqual({ body: 'Me too' })
    expect(comment.id).toBe('1')
    expect(comment.body).toBe('Me too')
  })

  test('401 classifies as auth-failed', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Bad credentials' }, 401)))
    const caught = await githubCreateTaskComment(config, '1347', 'Me too').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'auth-failed')
  })
})

describe('githubUpdateTaskComment', () => {
  test('PATCHes the comments collection by comment id, not the per-issue path', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: commentResponse({ id: 99, body: 'Edited' }) })).handler)
    const comment = await githubUpdateTaskComment(config, '1347', '99', 'Edited')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/comments/99')
    expect(calls[0]?.url.pathname).not.toContain('1347')
    expect(calls[0]?.body).toEqual({ body: 'Edited' })
    expect(comment.id).toBe('99')
    expect(comment.body).toBe('Edited')
  })

  test('429 classifies as rate-limited', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Too many requests' }, 429)))
    const caught = await githubUpdateTaskComment(config, '1347', '99', 'Edited').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'rate-limited')
  })
})

describe('githubDeleteTaskComment', () => {
  test('DELETEs the comments collection and returns { id } on 204', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: null, status: 204 })).handler)
    const result = await githubDeleteTaskComment(config, '1347', '99')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/comments/99')
    expect(result).toEqual({ id: '99' })
  })

  test('404 carries the task context as task-not-found', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubDeleteTaskComment(config, '1347', '99').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'task-not-found')
    expect(caught.appError).toHaveProperty('taskId', '1347')
  })
})
