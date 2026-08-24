// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../../plugins/task-provider-github/client.js'
import {
  githubAddTaskLabels,
  githubClearTaskLabels,
  githubCreateLabel,
  githubDeleteLabel,
  githubGetTaskLabels,
  githubListLabels,
  githubRemoveTaskLabel,
  githubSetTaskLabels,
  githubUpdateLabel,
  resolveLabelName,
} from '../../../../plugins/task-provider-github/operations/labels.js'
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
      // GitHub answers label deletions with 204 and no body at all.
      if (response.status === 204) return Promise.resolve(noContentResponse())
      return Promise.resolve(jsonResponse(response.data, response.status ?? 200))
    },
  }
}

const repoLabelResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 208045946,
  node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
  url: 'https://api.github.com/repos/octocat/Hello-World/labels/bug',
  name: 'bug',
  color: 'f29513',
  default: true,
  description: "Something isn't working",
  ...overrides,
})

const repoLabelPage = (count: number, offset = 0): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, i) => repoLabelResponse({ id: offset + i + 1, name: `label-${offset + i + 1}` }))

afterEach(() => {
  restoreFetch()
})

describe('githubListLabels', () => {
  test('paginates GET /repos/{o}/{r}/labels to exhaustion and normalizes', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureRequests(calls, sequenceResponder([{ data: repoLabelPage(100) }, { data: repoLabelPage(2, 100) }]))
        .handler,
    )
    const labels = await githubListLabels(config)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/repos/octocat/Hello-World/labels',
      '/repos/octocat/Hello-World/labels',
    ])
    expect(calls[0]?.url.searchParams.get('page')).toBe('1')
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('100')
    expect(calls[1]?.url.searchParams.get('page')).toBe('2')
    expect(labels).toHaveLength(102)
    expect(labels[0]).toEqual({ id: '1', name: 'label-1', color: 'f29513' })
  })

  test('404 on a missing repository classifies as project-not-found', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubListLabels(config).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'octocat/Hello-World')
  })
})

describe('githubCreateLabel', () => {
  test('POSTs name, color, and description when provided', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureRequests(calls, () => ({
        data: repoLabelResponse({ name: 'critical', color: 'ff0000', description: 'Drop everything' }),
        status: 201,
      })).handler,
    )
    const label = await githubCreateLabel(config, { name: 'critical', color: 'ff0000', description: 'Drop everything' })
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/labels')
    expect(calls[0]?.body).toEqual({ name: 'critical', color: 'ff0000', description: 'Drop everything' })
    expect(label).toEqual({ id: '208045946', name: 'critical', color: 'ff0000' })
  })

  test('minimal create sends only the name', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: repoLabelResponse({ name: 'triage' }), status: 201 })).handler)
    await githubCreateLabel(config, { name: 'triage' })
    expect(calls[0]?.body).toEqual({ name: 'triage' })
  })

  test('422 classifies as validation-failed', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Validation Failed' }, 422)))
    const caught = await githubCreateLabel(config, { name: 'bad' }).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'validation-failed')
  })
})

describe('githubUpdateLabel', () => {
  test('PATCHes the URL-encoded current name, sending only provided fields', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureRequests(calls, () => ({ data: repoLabelResponse({ name: 'crash', color: '000000' }) })).handler,
    )
    const label = await githubUpdateLabel(config, 'bug/fix?', { name: 'crash', color: '000000' })
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/labels/bug%2Ffix%3F')
    expect(calls[0]?.body).toEqual({ new_name: 'crash', color: '000000' })
    expect(label).toEqual({ id: '208045946', name: 'crash', color: '000000' })
  })

  test('401 classifies as auth-failed', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Bad credentials' }, 401)))
    const caught = await githubUpdateLabel(config, 'bug', { color: '000000' }).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'auth-failed')
  })
})

describe('githubDeleteLabel', () => {
  test('DELETEs the URL-encoded name and returns { id } on 204', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: null, status: 204 })).handler)
    const result = await githubDeleteLabel(config, 'bug/fix?')
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/labels/bug%2Ffix%3F')
    expect(result).toEqual({ id: 'bug/fix?' })
  })

  test('429 classifies as rate-limited', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Too many requests' }, 429)))
    const caught = await githubDeleteLabel(config, 'bug').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'rate-limited')
  })
})

describe('githubGetTaskLabels', () => {
  test('GETs the issue labels path and maps string-form labels', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: ['bug', 'help wanted'] })).handler)
    const labels = await githubGetTaskLabels(config, '1347')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/labels')
    expect(labels).toEqual([
      { id: 'bug', name: 'bug' },
      { id: 'help wanted', name: 'help wanted' },
    ])
  })

  test('object-form labels map with stringified id and color', async () => {
    mockLogger()
    setMockFetch(captureRequests([], () => ({ data: [repoLabelResponse()] })).handler)
    const labels = await githubGetTaskLabels(config, '1347')
    expect(labels).toEqual([{ id: '208045946', name: 'bug', color: 'f29513' }])
  })

  test('404 classifies as task-not-found with the task id', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubGetTaskLabels(config, '1347').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'task-not-found')
    expect(caught.appError).toHaveProperty('taskId', '1347')
  })
})

describe('githubSetTaskLabels', () => {
  test('PUT carries the full desired label-name set', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: ['c'] })).handler)
    await githubSetTaskLabels(config, '1347', ['c'])
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/labels')
    expect(calls[0]?.body).toEqual({ labels: ['c'] })
  })
})

describe('githubAddTaskLabels', () => {
  test('POSTs the incremental label-name set', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: ['a', 'b', 'c'] })).handler)
    await githubAddTaskLabels(config, '1347', ['c'])
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/labels')
    expect(calls[0]?.body).toEqual({ labels: ['c'] })
  })

  test('404 classifies as task-not-found', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubAddTaskLabels(config, '1347', ['c']).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'task-not-found')
    expect(caught.appError).toHaveProperty('taskId', '1347')
  })
})

describe('githubRemoveTaskLabel', () => {
  test('DELETEs the URL-encoded label name from the issue', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: null, status: 204 })).handler)
    await githubRemoveTaskLabel(config, '1347', 'bug/fix?')
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/labels/bug%2Ffix%3F')
  })
})

describe('githubClearTaskLabels', () => {
  test('DELETEs the issue labels collection', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    setMockFetch(captureRequests(calls, () => ({ data: null, status: 204 })).handler)
    await githubClearTaskLabels(config, '1347')
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/issues/1347/labels')
  })
})

describe('resolveLabelName', () => {
  test('purely numeric ref resolves by id through one list pass', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const { fetches, handler } = captureRequests(calls, () => ({ data: [repoLabelResponse()] }))
    setMockFetch(handler)
    const name = await resolveLabelName(config, '208045946')
    expect(fetches()).toBe(1)
    expect(calls[0]?.url.pathname).toBe('/repos/octocat/Hello-World/labels')
    expect(name).toBe('bug')
  })

  test('non-numeric ref is used directly with no lookup', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const { fetches, handler } = captureRequests(calls, () => ({ data: [repoLabelResponse()] }))
    setMockFetch(handler)
    const name = await resolveLabelName(config, 'bug')
    expect(fetches()).toBe(0)
    expect(name).toBe('bug')
  })

  test('unresolved numeric ref falls through as the name', async () => {
    mockLogger()
    setMockFetch(captureRequests([], () => ({ data: [repoLabelResponse()] })).handler)
    const name = await resolveLabelName(config, '999')
    expect(name).toBe('999')
  })
})
