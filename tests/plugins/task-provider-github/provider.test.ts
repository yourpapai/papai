// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../plugins/task-provider-github/classify-error.js'
import { GitHubApiError } from '../../../plugins/task-provider-github/client.js'
import { GITHUB_CAPABILITIES, GITHUB_TRAITS } from '../../../plugins/task-provider-github/constants.js'
import { GITHUB_PROMPT_ADDENDUM } from '../../../plugins/task-provider-github/prompt-addendum.js'
import { GitHubProvider } from '../../../plugins/task-provider-github/provider.js'
import type { TaskProvider } from '../../../src/providers/types.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

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

const captureRequests = (
  sink: CapturedRequest[],
): { fetches: () => number; handler: (url: string, init: RequestInit) => Promise<Response> } => {
  let calls = 0
  return {
    fetches: (): number => calls,
    handler: (url: string, init: RequestInit): Promise<Response> => {
      calls += 1
      const bodyText = typeof init.body === 'string' ? init.body : undefined
      const response = endpointResponder(url, init)
      sink.push({
        url: new URL(url),
        method: init.method ?? '',
        body: bodyText === undefined ? {} : parseBodyText(bodyText),
      })
      return Promise.resolve(jsonResponse(response.data, response.status ?? 200))
    },
  }
}

const issuePayload = (): Record<string, unknown> => ({
  id: 1,
  number: 1347,
  title: 'Found a bug',
  body: null,
  user: null,
  labels: [],
  assignees: [],
  state: 'open',
  state_reason: null,
  comments: 0,
  created_at: '2011-01-26T19:01:12Z',
  updated_at: '2011-01-26T19:01:12Z',
  closed_at: null,
  milestone: null,
  html_url: 'https://github.com/octocat/Hello-World/issues/1347',
})

/** Serves the payload shape each GitHub endpoint expects, keyed by method+path. */
const repoPayload = (): Record<string, unknown> => ({
  id: 1296269,
  name: 'Hello-World',
  full_name: 'octocat/Hello-World',
  owner: { login: 'octocat', id: 1, avatar_url: '', html_url: '', type: 'User' },
  html_url: 'https://github.com/octocat/Hello-World',
  private: false,
  description: null,
})

/** Serves the payload shape each GitHub endpoint expects, keyed by method+path. */
const endpointResponder = (url: string, init: RequestInit): { data: unknown; status?: number } => {
  const parsed = new URL(url)
  if (parsed.pathname === '/search/issues') return { data: { total_count: 0, items: [] } }
  if (parsed.pathname === '/repos/octocat/Hello-World') return { data: repoPayload() }
  if (parsed.pathname === '/repos/octocat/Hello-World/issues') {
    const isList = (init.method ?? 'GET') === 'GET'
    return { data: isList ? [] : issuePayload(), status: isList ? 200 : 201 }
  }
  return { data: issuePayload() }
}

const makeProvider = (): GitHubProvider =>
  new GitHubProvider({ baseUrl: '', repo: 'octocat/Hello-World', token: 'tkn' })

afterEach(() => {
  restoreFetch()
})

describe('GitHubProvider', () => {
  test('implements TaskProvider with the github identity and constants', () => {
    mockLogger()
    const provider: TaskProvider = makeProvider()
    expect(provider.name).toBe('github')
    expect(provider.capabilities).toEqual(GITHUB_CAPABILITIES)
    expect(provider.capabilities).toEqual(
      new Set([
        'projects.list',
        'projects.read',
        'comments.read',
        'comments.create',
        'comments.update',
        'comments.delete',
        'labels.list',
        'labels.create',
        'labels.update',
        'labels.delete',
        'labels.assign',
      ]),
    )
    expect(provider.traits).toEqual(GITHUB_TRAITS)
    expect(provider.traits.size).toBe(0)
    expect(provider.preferredUserIdentifier).toBe('login')
  })

  test('required task methods are wired to the GitHub operations', async () => {
    mockLogger()
    const provider = makeProvider()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls).handler)

    await provider.createTask({ projectId: 'octocat/Hello-World', title: 'Found a bug' })
    await provider.getTask('1347')
    await provider.updateTask('1347', { title: 'New' })
    await provider.listTasks('octocat/Hello-World')
    await provider.searchTasks({ query: 'everything' })

    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      'POST /repos/octocat/Hello-World/issues',
      'GET /repos/octocat/Hello-World/issues/1347',
      'PATCH /repos/octocat/Hello-World/issues/1347',
      'GET /repos/octocat/Hello-World/issues',
      'GET /search/issues',
    ])
  })

  test('createTask rejects a foreign projectId as project-not-found before any request', async () => {
    mockLogger()
    const provider = makeProvider()
    const calls: CapturedRequest[] = []
    const capture = captureRequests(calls)
    setMockFetch(capture.handler)
    const caught = await provider
      .createTask({ projectId: 'other/repo', title: 'Found a bug' })
      .catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'other/repo')
    expect(capture.fetches()).toBe(0)
  })

  test('offers no optional capability methods beyond getProject/listProjects', () => {
    mockLogger()
    const provider: TaskProvider = makeProvider()
    const forbidden: Array<keyof TaskProvider> = [
      'deleteTask',
      'listUsers',
      'getCurrentUser',
      'provisionWorkspaceMember',
      'describeProjectFields',
      'createProject',
      'updateProject',
      'deleteProject',
      'listProjectTeam',
      'addProjectMember',
      'removeProjectMember',
      'getComment',
      'addComment',
      'getComments',
      'updateComment',
      'removeComment',
      'addCommentReaction',
      'removeCommentReaction',
      'listLabels',
      'listTaskLabels',
      'getLabelByName',
      'createLabel',
      'updateLabel',
      'removeLabel',
      'addTaskLabel',
      'removeTaskLabel',
      'addRelation',
      'updateRelation',
      'removeRelation',
      'listWatchers',
      'addWatcher',
      'removeWatcher',
      'addVote',
      'removeVote',
      'setVisibility',
      'applyCommand',
      'listStatuses',
      'createStatus',
      'updateStatus',
      'deleteStatus',
      'reorderStatuses',
      'listAttachments',
      'uploadAttachment',
      'deleteAttachment',
      'listWorkItems',
      'createWorkItem',
      'updateWorkItem',
      'deleteWorkItem',
      'listAgiles',
      'listSprints',
      'createSprint',
      'updateSprint',
      'assignTaskToSprint',
      'getTaskHistory',
      'listSavedQueries',
      'runSavedQuery',
      'countTasks',
    ]
    for (const method of forbidden) {
      expect(provider[method], method).toBeUndefined()
    }
    expect(typeof provider.getProject).toBe('function')
    expect(typeof provider.listProjects).toBe('function')
  })

  test('closing is a status update through updateTask (PATCH with completed reason)', async () => {
    mockLogger()
    const provider = makeProvider()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls).handler)
    const task = await provider.updateTask('1347', { status: 'closed' })
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.body).toEqual({ state: 'closed', state_reason: 'completed' })
    expect(task.id).toBe('1347')
  })

  test('project methods are wired to the GitHub project operations', async () => {
    mockLogger()
    const provider = makeProvider()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls).handler)
    const projects = await provider.listProjects()
    const project = await provider.getProject('octocat/Hello-World')
    expect(projects).toHaveLength(1)
    expect(project.id).toBe('octocat/Hello-World')
    expect(calls).toHaveLength(2)
  })

  test('buildTaskUrl and buildProjectUrl derive web URLs from the API base', () => {
    mockLogger()
    const provider = makeProvider()
    expect(provider.buildTaskUrl('1347')).toBe('https://github.com/octocat/Hello-World/issues/1347')
    expect(provider.buildProjectUrl('octocat/Hello-World')).toBe('https://github.com/octocat/Hello-World')
    const ghes = new GitHubProvider({ baseUrl: 'https://ghes.example.com/api/v3', repo: 'o/r', token: 't' })
    expect(ghes.buildTaskUrl('42', 'o/r')).toBe('https://ghes.example.com/o/r/issues/42')
    expect(ghes.buildProjectUrl('o/r')).toBe('https://ghes.example.com/o/r')
  })

  test('classifyError exposes the AppError classification', () => {
    mockLogger()
    const provider = makeProvider()
    const appError = provider.classifyError(
      new GitHubApiError('upstream', 401, new Headers(), { message: 'Bad credentials' }),
    )
    expect(appError).toMatchObject({ type: 'provider', code: 'auth-failed' })
  })

  test('prompt addendum, due-date, and list-param plumbing are wired', () => {
    mockLogger()
    const provider = makeProvider()
    expect(provider.getPromptAddendum()).toBe(GITHUB_PROMPT_ADDENDUM)
    expect(provider.normalizeDueDateInput({ date: '2026-01-01', time: '10:00' }, 'UTC')).toBeUndefined()
    expect(provider.normalizeDueDateInput(undefined, 'UTC')).toBeUndefined()
    expect(provider.formatDueDateOutput('2026-01-01', 'UTC')).toBe('2026-01-01')
    expect(provider.formatDueDateOutput(null, 'UTC')).toBeNull()
    const params = { status: 'open', limit: 5 }
    expect(provider.normalizeListTaskParams(params)).toEqual(params)
  })
})
