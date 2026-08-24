// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../../plugins/task-provider-github/client.js'
import { githubListTaskEvents } from '../../../../plugins/task-provider-github/operations/activities.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const config: GitHubConfig = { baseUrl: '', repo: 'octocat/Hello-World', token: 'test-token' }

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

type CapturedRequest = Readonly<{ url: URL; method: string }>

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
      const response = respond(current)
      sink.push({ url: new URL(url), method: init.method ?? '' })
      return Promise.resolve(jsonResponse(response.data, response.status ?? 200))
    },
  }
}

const sequenceResponder =
  (responses: Array<{ data: unknown; status?: number }>) =>
  (call: number): { data: unknown; status?: number } =>
    responses[call] ?? { data: [] }

const octocat = {
  login: 'octocat',
  id: 583231,
  avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
  html_url: 'https://github.com/octocat',
  type: 'User',
}

const hubot = { ...octocat, login: 'hubot', id: 1, type: 'Bot' }

type EventOverrides = Partial<{
  id: number
  event: string
  created_at: string
  actor: Record<string, unknown> | null
  assignee: Record<string, unknown> | null
  label: Record<string, unknown> | null
}>

const issueEvent = (overrides: EventOverrides = {}): Record<string, unknown> => ({
  id: 1,
  event: 'closed',
  actor: octocat,
  created_at: '2011-04-14T16:00:49Z',
  node_id: 'MDE1OkV2ZW50MQ==',
  url: 'https://api.github.com/repos/octocat/Hello-World/issues/events/1',
  commit_id: null,
  commit_url: null,
  performed_via_github_app: null,
  ...overrides,
})

const eventsPath = '/repos/octocat/Hello-World/issues/1347/events'

afterEach(() => {
  restoreFetch()
})

describe('githubListTaskEvents', () => {
  test('hits the issue events endpoint and follows pagination to exhaustion', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const fullPage = Array.from({ length: 100 }, (_, i) => issueEvent({ id: i + 1, event: 'commented' }))
    const shortPage = [issueEvent({ id: 101, event: 'commented' })]
    setMockFetch(captureRequests(calls, sequenceResponder([{ data: fullPage }, { data: shortPage }])).handler)
    const activities = await githubListTaskEvents(config, '1347')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url.pathname).toBe(eventsPath)
    expect(calls[0]?.url.searchParams.get('page')).toBe('1')
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('100')
    expect(calls[1]?.url.searchParams.get('page')).toBe('2')
    expect(activities).toHaveLength(101)
  })

  test('maps each known event type onto the normalized activity shape', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [
      issueEvent({ id: 1, event: 'assigned', created_at: '2011-04-11T10:00:00Z', assignee: hubot }),
      issueEvent({
        id: 2,
        event: 'labeled',
        created_at: '2011-04-11T11:00:00Z',
        label: { name: 'bug', color: 'f29513' },
      }),
      issueEvent({ id: 3, event: 'unlabeled', created_at: '2011-04-11T12:00:00Z', label: { name: 'wontfix' } }),
      issueEvent({ id: 4, event: 'closed', created_at: '2011-04-11T13:00:00Z' }),
      issueEvent({ id: 5, event: 'reopened', created_at: '2011-04-11T14:00:00Z' }),
      issueEvent({ id: 6, event: 'commented', created_at: '2011-04-11T15:00:00Z' }),
    ]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const activities = await githubListTaskEvents(config, '1347')
    expect(activities).toEqual([
      { id: '1', timestamp: '2011-04-11T10:00:00Z', author: 'octocat', category: 'assignee', added: 'hubot' },
      { id: '2', timestamp: '2011-04-11T11:00:00Z', author: 'octocat', category: 'label', added: 'bug' },
      { id: '3', timestamp: '2011-04-11T12:00:00Z', author: 'octocat', category: 'label', removed: 'wontfix' },
      { id: '4', timestamp: '2011-04-11T13:00:00Z', author: 'octocat', category: 'status', added: 'closed' },
      { id: '5', timestamp: '2011-04-11T14:00:00Z', author: 'octocat', category: 'status', added: 'open' },
      { id: '6', timestamp: '2011-04-11T15:00:00Z', author: 'octocat', category: 'comment' },
    ])
  })

  test('drops unknown event types', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [
      issueEvent({ id: 1, event: 'renamed', created_at: '2011-04-11T10:00:00Z' }),
      issueEvent({ id: 2, event: 'milestoned', created_at: '2011-04-11T11:00:00Z' }),
      issueEvent({ id: 3, event: 'commented', created_at: '2011-04-11T12:00:00Z' }),
    ]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const activities = await githubListTaskEvents(config, '1347')
    expect(activities).toHaveLength(1)
    expect(activities[0]?.id).toBe('3')
  })

  test('actor-less events carry no author', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [issueEvent({ id: 7, event: 'closed', actor: null })]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const activities = await githubListTaskEvents(config, '1347')
    expect(activities[0]?.author).toBeUndefined()
  })

  test('author filter keeps only that author before ordering', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [
      issueEvent({ id: 1, event: 'commented', actor: octocat, created_at: '2011-04-11T10:00:00Z' }),
      issueEvent({ id: 2, event: 'commented', actor: hubot, created_at: '2011-04-11T11:00:00Z' }),
    ]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const activities = await githubListTaskEvents(config, '1347', { author: 'hubot' })
    expect(activities).toHaveLength(1)
    expect(activities[0]?.author).toBe('hubot')
  })

  test('categories filter keeps only matching categories', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [
      issueEvent({ id: 1, event: 'closed', created_at: '2011-04-11T10:00:00Z' }),
      issueEvent({ id: 2, event: 'labeled', label: { name: 'bug' }, created_at: '2011-04-11T11:00:00Z' }),
    ]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const activities = await githubListTaskEvents(config, '1347', { categories: ['label'] })
    expect(activities).toHaveLength(1)
    expect(activities[0]?.category).toBe('label')
  })

  test('start/end window keeps events inside the bounds', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [
      issueEvent({ id: 1, event: 'commented', created_at: '2011-04-10T10:00:00Z' }),
      issueEvent({ id: 2, event: 'commented', created_at: '2011-04-11T10:00:00Z' }),
      issueEvent({ id: 3, event: 'commented', created_at: '2011-04-12T10:00:00Z' }),
    ]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const activities = await githubListTaskEvents(config, '1347', {
      start: '2011-04-11T00:00:00Z',
      end: '2011-04-12T00:00:00Z',
    })
    expect(activities).toHaveLength(1)
    expect(activities[0]?.id).toBe('2')
  })

  test('sorts ascending, reverses, then slices with limit/offset', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const page = [
      issueEvent({ id: 3, event: 'commented', created_at: '2011-04-13T10:00:00Z' }),
      issueEvent({ id: 1, event: 'commented', created_at: '2011-04-11T10:00:00Z' }),
      issueEvent({ id: 4, event: 'commented', created_at: '2011-04-14T10:00:00Z' }),
      issueEvent({ id: 2, event: 'commented', created_at: '2011-04-12T10:00:00Z' }),
    ]
    setMockFetch(captureRequests(calls, () => ({ data: page })).handler)
    const ascending = await githubListTaskEvents(config, '1347')
    expect(ascending.map((activity) => activity.id)).toEqual(['1', '2', '3', '4'])
    const reversed = await githubListTaskEvents(config, '1347', { reverse: true })
    expect(reversed.map((activity) => activity.id)).toEqual(['4', '3', '2', '1'])
    const window = await githubListTaskEvents(config, '1347', { reverse: true, offset: 1, limit: 2 })
    expect(window.map((activity) => activity.id)).toEqual(['3', '2'])
  })

  test('404 classifies as task-not-found with the task id', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubListTaskEvents(config, '1347').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'task-not-found')
    expect(caught.appError).toHaveProperty('taskId', '1347')
  })
})
