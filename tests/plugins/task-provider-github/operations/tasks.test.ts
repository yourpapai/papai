// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../../plugins/task-provider-github/client.js'
import {
  githubCreateTask,
  githubGetTask,
  githubListTasks,
  githubSearchTasks,
  githubUpdateTask,
} from '../../../../plugins/task-provider-github/operations/tasks.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const config: GitHubConfig = { baseUrl: '', repo: 'octocat/Hello-World', token: 'test-token' }

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

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

const issueResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1,
  number: 1347,
  title: 'Found a bug',
  body: "I'm having a problem with this.",
  user,
  labels: [],
  assignees: [],
  state: 'open',
  state_reason: null,
  comments: 10,
  created_at: '2011-01-26T19:01:12Z',
  updated_at: '2011-01-26T19:01:12Z',
  closed_at: null,
  milestone: null,
  html_url: 'https://github.com/octocat/Hello-World/issues/1347',
  ...overrides,
})

afterEach(() => {
  restoreFetch()
})

describe('githubCreateTask', () => {
  test('POSTs title, body, and assignees; priority/dueDate/startDate accepted and ignored', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: issueResponse({ state: 'open' }), status: 201 })).handler)
    const task = await githubCreateTask(config, {
      projectId: 'octocat/Hello-World',
      title: 'Found a bug',
      description: 'It broke',
      assignee: 'hubot',
      priority: 'high',
      dueDate: '2026-01-01',
      startDate: '2025-12-01',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues')
    expect(calls[0]?.body).toEqual({ title: 'Found a bug', body: 'It broke', assignees: ['hubot'] })
    expect(task.id).toBe('1347')
    expect(task.status).toBe('open')
    expect(task.priority).toBeUndefined()
    expect(task.dueDate).toBeUndefined()
  })

  test('minimal create sends only the title', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: issueResponse(), status: 201 })).handler)
    await githubCreateTask(config, { projectId: 'octocat/Hello-World', title: 'Found a bug' })
    expect(calls[0]?.body).toEqual({ title: 'Found a bug' })
  })
})

describe('githubGetTask', () => {
  test('GETs the issue and returns the normalized task', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: issueResponse() })).handler)
    const task = await githubGetTask(config, '1347')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347')
    expect(task.id).toBe('1347')
    expect(task.url).toBe('https://github.com/octocat/Hello-World/issues/1347')
  })

  test('404 classifies as task-not-found with the task id', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubGetTask(config, '1347').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'task-not-found')
    expect(caught.appError).toHaveProperty('taskId', '1347')
  })
})

describe('githubUpdateTask', () => {
  test("status 'closed' maps to completed close", async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureRequests(calls, () => ({
        data: issueResponse({ state: 'closed', state_reason: 'completed', closed_at: '2011-01-27T10:00:00Z' }),
      })).handler,
    )
    const task = await githubUpdateTask(config, '1347', { status: 'closed' })
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347')
    expect(calls[0]?.body).toEqual({ state: 'closed', state_reason: 'completed' })
    expect(task.status).toBe('closed')
  })

  test("canonical status 'closed (not_planned)' maps to the not_planned close reason", async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureRequests(calls, () => ({ data: issueResponse({ state: 'closed', state_reason: 'not_planned' }) })).handler,
    )
    await githubUpdateTask(config, '1347', { status: 'closed (not_planned)' })
    expect(calls[0]?.body).toEqual({ state: 'closed', state_reason: 'not_planned' })
  })

  test("status 'open' maps to reopening without a close reason", async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: issueResponse() })).handler)
    await githubUpdateTask(config, '1347', { status: 'open' })
    expect(calls[0]?.body).toEqual({ state: 'open' })
  })

  test('title, description, and assignee updates are applied', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: issueResponse() })).handler)
    await githubUpdateTask(config, '1347', { title: 'New title', description: 'New body', assignee: 'hubot' })
    expect(calls[0]?.body).toEqual({ title: 'New title', body: 'New body', assignees: ['hubot'] })
  })

  test('ignored fields (priority, dates) never reach the PATCH body', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: issueResponse() })).handler)
    await githubUpdateTask(config, '1347', { priority: 'high', dueDate: '2026-01-01', startDate: '2025-12-01' })
    expect(calls[0]?.body).toEqual({})
  })
})

describe('githubListTasks', () => {
  test('paginates to exhaustion and drops PR-marked items', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const fullPage = Array.from({ length: 100 }, (_, i) => issueResponse({ number: i + 1, id: i + 1 }))
    const shortPage = [
      issueResponse({ number: 101, id: 101 }),
      issueResponse({ number: 102, id: 102, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/102' } }),
    ]
    setMockFetch(captureRequests(calls, sequenceResponder([{ data: fullPage }, { data: shortPage }])).handler)
    const items = await githubListTasks(config, 'octocat/Hello-World')
    expect(items).toHaveLength(101)
    expect(items[0]?.id).toBe('1')
    expect(items[100]?.id).toBe('101')
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/repos/octocat/Hello-World/issues',
      '/repos/octocat/Hello-World/issues',
    ])
    expect(calls[0]?.url.searchParams.get('page')).toBe('1')
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('100')
    expect(calls[0]?.url.searchParams.get('state')).toBeNull()
    expect(calls[1]?.url.searchParams.get('page')).toBe('2')
  })

  test("status filter 'open' maps onto the state query param", async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: [] })).handler)
    await githubListTasks(config, 'octocat/Hello-World', { status: 'open' })
    expect(calls[0]?.url.searchParams.get('state')).toBe('open')
  })

  test('both closed status forms map onto state=closed', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: [] })).handler)
    await githubListTasks(config, 'octocat/Hello-World', { status: 'closed' })
    expect(calls[0]?.url.searchParams.get('state')).toBe('closed')
    const secondCalls: CapturedRequest[] = []
    setMockFetch(captureRequests(secondCalls, () => ({ data: [] })).handler)
    await githubListTasks(config, 'octocat/Hello-World', { status: 'closed (not_planned)' })
    expect(secondCalls[0]?.url.searchParams.get('state')).toBe('closed')
  })
})

describe('githubSearchTasks', () => {
  test('scopes to the repo, pins is:issue, passes qualifiers, honors limit and offset', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const items = Array.from({ length: 5 }, (_, i) => issueResponse({ number: i + 1, id: i + 1 }))
    setMockFetch(captureRequests(calls, () => ({ data: { total_count: 5, items } })).handler)
    const results = await githubSearchTasks(config, {
      query: 'label:bug crashed',
      limit: 2,
      offset: 1,
    })
    expect(calls[0]?.url.pathname).toBe('/search/issues')
    expect(calls[0]?.url.searchParams.get('q')).toBe('repo:octocat/Hello-World is:issue label:bug crashed')
    expect(results).toHaveLength(2)
    expect(results[0]?.id).toBe('2')
    expect(results[1]?.id).toBe('3')
  })

  test('without limit/offset returns the full result set', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const items = Array.from({ length: 3 }, (_, i) => issueResponse({ number: i + 1, id: i + 1 }))
    setMockFetch(captureRequests(calls, () => ({ data: { total_count: 3, items } })).handler)
    const results = await githubSearchTasks(config, { query: 'everything' })
    expect(calls[0]?.url.searchParams.get('q')).toBe('repo:octocat/Hello-World is:issue everything')
    expect(results).toHaveLength(3)
  })
})
