// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../../plugins/task-provider-github/client.js'
import { githubGetProject, githubListProjects } from '../../../../plugins/task-provider-github/operations/projects.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const config: GitHubConfig = { baseUrl: '', repo: 'octocat/Hello-World', token: 'test-token' }

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

type CapturedRequest = Readonly<{ url: string; method: string }>

type RequestCapture = Readonly<{
  fetches: () => number
  handler: (url: string, init: RequestInit) => Promise<Response>
}>

const captureRequests = (sink: CapturedRequest[], respond: () => Record<string, unknown>): RequestCapture => {
  let fetches = 0
  return {
    fetches: (): number => fetches,
    handler: (url: string, init: RequestInit): Promise<Response> => {
      fetches += 1
      sink.push({ url, method: init.method ?? '' })
      return Promise.resolve(jsonResponse(respond()))
    },
  }
}

const repoResponse = (): Record<string, unknown> => ({
  id: 1296269,
  name: 'Hello-World',
  full_name: 'octocat/Hello-World',
  owner: {
    login: 'octocat',
    id: 583231,
    avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
    html_url: 'https://github.com/octocat',
    type: 'User',
  },
  html_url: 'https://github.com/octocat/Hello-World',
  private: false,
  description: 'This your first repo!',
})

const expectedProject = {
  id: 'octocat/Hello-World',
  name: 'Hello-World',
  description: 'This your first repo!',
  url: 'https://github.com/octocat/Hello-World',
}

afterEach(() => {
  restoreFetch()
})

describe('githubListProjects', () => {
  test('issues GET /repos/{owner}/{repo} and returns exactly the configured repo', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const capture = captureRequests(calls, repoResponse)
    setMockFetch(capture.handler)
    const projects = await githubListProjects(config)
    expect(projects).toEqual([expectedProject])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://api.github.com/repos/octocat/Hello-World')
  })

  test('upstream 404 classifies as project-not-found', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubListProjects(config).catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'octocat/Hello-World')
  })
})

describe('githubGetProject', () => {
  test('returns the configured repo for the matching id', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const capture = captureRequests(calls, repoResponse)
    setMockFetch(capture.handler)
    const project = await githubGetProject(config, 'octocat/Hello-World')
    expect(project).toEqual(expectedProject)
    expect(calls.map((call) => call.url)).toEqual(['https://api.github.com/repos/octocat/Hello-World'])
  })

  test('a mismatching id classifies as project-not-found without any request', async () => {
    mockLogger()
    const calls: CapturedRequest[] = []
    const capture = captureRequests(calls, repoResponse)
    setMockFetch(capture.handler)
    const caught = await githubGetProject(config, 'other/repo').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'other/repo')
    expect(capture.fetches()).toBe(0)
  })

  test('upstream 404 classifies as project-not-found', async () => {
    mockLogger()
    setMockFetch(() => Promise.resolve(jsonResponse({ message: 'Not Found' }, 404)))
    const caught = await githubGetProject(config, 'octocat/Hello-World').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'octocat/Hello-World')
  })
})
