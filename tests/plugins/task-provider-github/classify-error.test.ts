// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { classifyGitHubError, GitHubClassifiedError } from '../../../plugins/task-provider-github/classify-error.js'
import { GitHubApiError } from '../../../plugins/task-provider-github/client.js'
import { getUserMessage, providerError, systemError } from '../../../src/errors.js'

const headersOf = (entries: Record<string, string> = {}): Headers => new Headers(entries)

const apiError = (statusCode: number, headers: Record<string, string> = {}): GitHubApiError =>
  new GitHubApiError(`GitHub API request failed with status ${statusCode}`, statusCode, headersOf(headers), {
    message: 'upstream message',
  })

describe('classifyGitHubError', () => {
  describe('HTTP status classification', () => {
    test('plain 401 → authFailed', () => {
      const result = classifyGitHubError(apiError(401))
      expect(result.appError).toEqual(providerError.authFailed())
    })

    test('plain 403 → authFailed', () => {
      const result = classifyGitHubError(apiError(403))
      expect(result.appError).toEqual(providerError.authFailed())
    })

    test('rate-limit-shaped 403 (x-ratelimit-remaining: 0) → rateLimited, not authFailed', () => {
      const result = classifyGitHubError(apiError(403, { 'x-ratelimit-remaining': '0' }))
      expect(result.appError).toEqual(providerError.rateLimited())
    })

    test('rate-limit-shaped 403 (Retry-After) → rateLimited', () => {
      const result = classifyGitHubError(apiError(403, { 'Retry-After': '30' }))
      expect(result.appError).toEqual(providerError.rateLimited())
    })

    test('429 → rateLimited', () => {
      const result = classifyGitHubError(apiError(429))
      expect(result.appError).toEqual(providerError.rateLimited())
    })

    test('404 in issue context → task-not-found', () => {
      const result = classifyGitHubError(apiError(404), { taskId: '1347' })
      expect(result.appError).toEqual(providerError.taskNotFound('1347'))
      expect(result.appError).toHaveProperty('taskId', '1347')
      expect(getUserMessage(result.appError)).toContain('1347')
    })

    test('404 in repo context → project-not-found', () => {
      const result = classifyGitHubError(apiError(404), { projectId: 'octocat/Hello-World' })
      expect(result.appError).toEqual(providerError.projectNotFound('octocat/Hello-World'))
      expect(result.appError).toHaveProperty('projectId', 'octocat/Hello-World')
    })

    test('404 without context falls back to unknown ids but stays classified', () => {
      const taskResult = classifyGitHubError(apiError(404), { taskId: '1347' })
      expect(taskResult.appError.code).toBe('task-not-found')
      const projectResult = classifyGitHubError(apiError(404))
      expect(projectResult.appError).toHaveProperty('projectId', 'unknown')
    })

    test('400 → validationFailed', () => {
      const result = classifyGitHubError(apiError(400))
      expect(result.appError.code).toBe('validation-failed')
    })

    test('422 → validationFailed', () => {
      const result = classifyGitHubError(apiError(422))
      expect(result.appError.code).toBe('validation-failed')
    })

    test('500 → unexpected', () => {
      const result = classifyGitHubError(apiError(500))
      expect(result.appError.code).toBe('unexpected')
    })

    test('503 → unexpected', () => {
      const result = classifyGitHubError(apiError(503))
      expect(result.appError.code).toBe('unexpected')
    })
  })

  describe('network error patterns', () => {
    test('fetch failed → systemError.networkError', () => {
      const result = classifyGitHubError(new TypeError('fetch failed'))
      expect(result.appError).toEqual(systemError.networkError('fetch failed'))
    })

    test('econnrefused → systemError.networkError', () => {
      const result = classifyGitHubError(new Error('econnrefused 127.0.0.1:443'))
      expect(result.appError).toEqual(systemError.networkError('econnrefused 127.0.0.1:443'))
    })

    test('enotfound → systemError.networkError', () => {
      const result = classifyGitHubError(new Error('enotfound api.github.com'))
      expect(result.appError).toEqual(systemError.networkError('enotfound api.github.com'))
    })

    test('network in message → systemError.networkError', () => {
      const result = classifyGitHubError(new Error('network unreachable'))
      expect(result.appError).toEqual(systemError.networkError('network unreachable'))
    })

    test('connect in message → systemError.networkError', () => {
      const result = classifyGitHubError(new Error('connect timeout'))
      expect(result.appError).toEqual(systemError.networkError('connect timeout'))
    })
  })

  describe('passthrough and fallback', () => {
    test('already-classified errors pass through unchanged', () => {
      const original = classifyGitHubError(apiError(404), { taskId: '1347' })
      const again = classifyGitHubError(original, { taskId: 'other' })
      expect(again).toBe(original)
    })

    test('non-Error values → unexpected', () => {
      const result = classifyGitHubError('boom')
      expect(result.appError.code).toBe('unexpected')
    })

    test('unrecognized Error → unexpected', () => {
      const result = classifyGitHubError(new Error('something odd'))
      expect(result.appError.code).toBe('unexpected')
    })
  })

  describe('GitHubClassifiedError', () => {
    test('wraps AppError and carries the original message', () => {
      const result = classifyGitHubError(apiError(401))
      assert.ok(result instanceof GitHubClassifiedError)
      expect(result.name).toBe('GitHubClassifiedError')
      expect(result.appError.type).toBe('provider')
    })
  })
})
