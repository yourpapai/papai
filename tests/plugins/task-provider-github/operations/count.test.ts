// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../../plugins/task-provider-github/client.js'
import { githubCountTasks } from '../../../../plugins/task-provider-github/operations/count.js'
import { createTrackedLoggerMock } from '../../../utils/logger-mock.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

// count.ts creates its child logger at call time (see the module comment there),
// so a suite-level re-install after the global mock-reset restore is enough for
// log-level assertions even in combined runs where another file loaded the module
// first (tests/AGENTS.md).
const tracked = createTrackedLoggerMock()
const installTrackedLogger = (): void => {
  void mock.module('../../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))
}

const config: GitHubConfig = { baseUrl: '', repo: 'octocat/Hello-World', token: 'test-token' }

const jsonResponse = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })

type CapturedRequest = Readonly<{ url: URL; method: string }>

const captureRequests = (
  sink: CapturedRequest[],
  respond: () => Response,
): ((url: string, init: RequestInit) => Promise<Response>) => {
  return (url: string, init: RequestInit): Promise<Response> => {
    sink.push({ url: new URL(url), method: init.method ?? '' })
    return Promise.resolve(respond())
  }
}

afterEach(() => {
  restoreFetch()
  tracked.clearCalls()
})

describe('githubCountTasks', () => {
  beforeEach(() => {
    installTrackedLogger()
  })

  test('extracts total_count from a single search request with per_page=1 and the built q', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => jsonResponse({ total_count: 42, items: [] })))
    const count = await githubCountTasks(config, { query: 'crashed' })
    expect(count).toBe(42)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url.pathname).toBe('/search/issues')
    expect(calls[0]?.url.searchParams.get('q')).toBe('repo:octocat/Hello-World is:issue crashed in:title,body')
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('1')
  })

  test('empty query counts all issues in the repo without an in: clause', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => jsonResponse({ total_count: 7, items: [] })))
    const count = await githubCountTasks(config, { query: '' })
    expect(count).toBe(7)
    expect(calls[0]?.url.searchParams.get('q')).toBe('repo:octocat/Hello-World is:issue')
  })

  test('projectId equal to the configured repo succeeds', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => jsonResponse({ total_count: 3, items: [] })))
    const count = await githubCountTasks(config, { query: 'bug', projectId: 'octocat/Hello-World' })
    expect(count).toBe(3)
    expect(calls).toHaveLength(1)
  })

  test('projectId mismatch rejects as project-not-found before any request', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => jsonResponse({ total_count: 0, items: [] })))
    const caught = await githubCountTasks(config, { query: 'bug', projectId: 'other/repo' }).catch(
      (error: unknown) => error,
    )
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'other/repo')
    expect(calls).toHaveLength(0)
    expect(tracked.getCallsByLevel('warn').some((call) => call.args[1] === 'Project not found')).toBe(true)
    expect(tracked.getCallsByLevel('error')).toHaveLength(0)
  })

  test('401 classifies as auth failure', async () => {
    setMockFetch(captureRequests([], () => jsonResponse({ message: 'Bad credentials' }, 401)))
    const caught = await githubCountTasks(config, { query: 'bug' }).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'auth-failed')
  })

  test('rate-limit-shaped 403 (x-ratelimit-remaining: 0) classifies as rate-limited', async () => {
    setMockFetch(
      captureRequests([], () =>
        jsonResponse({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }),
      ),
    )
    const caught = await githubCountTasks(config, { query: 'bug' }).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'rate-limited')
  })

  test('429 with Retry-After classifies as rate-limited', async () => {
    setMockFetch(
      captureRequests([], () => jsonResponse({ message: 'Too many requests' }, 429, { 'Retry-After': '30' })),
    )
    const caught = await githubCountTasks(config, { query: 'bug' }).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'rate-limited')
  })
})
