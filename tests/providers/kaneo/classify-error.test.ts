// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { providerError } from '../../../src/errors.js'
import { classifyKaneoError, KaneoClassifiedError } from '../../../src/providers/kaneo/classify-error.js'
import { KaneoApiError, KaneoValidationError } from '../../../src/providers/kaneo/errors.js'

describe('classifyKaneoError', () => {
  test('returns authFailed for 401', () => {
    const error = new KaneoApiError('Unauthorized', 401, { error: 'Unauthorized' })
    const result = classifyKaneoError(error)
    expect(result.appError).toEqual(providerError.authFailed())
  })

  test('returns authFailed for 403', () => {
    const error = new KaneoApiError('Forbidden', 403, { error: 'Forbidden' })
    const result = classifyKaneoError(error)
    expect(result.appError).toEqual(providerError.authFailed())
  })

  test('returns authFailed for 401 with auth message', () => {
    const error = new KaneoApiError('Authentication failed', 401, { error: 'Auth failed' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('auth-failed')
  })

  test('returns taskNotFound for 404 with task in message', () => {
    const error = new KaneoApiError('Task not found', 404, { error: 'Not found' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('task-not-found')
  })

  test('returns taskNotFound for 404 with /task/ path', () => {
    const error = new KaneoApiError('GET /api/task/abc123 returned 404', 404, {
      error: 'Not found',
    })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('task-not-found')
  })

  test('returns projectNotFound for 404 with project in message', () => {
    const error = new KaneoApiError('Project not found', 404, { error: 'Not found' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('project-not-found')
  })

  test('returns labelNotFound for 404 with label in message', () => {
    const error = new KaneoApiError('Label not found', 404, { error: 'Not found' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('label-not-found')
  })

  test('returns commentNotFound for 404 with activity path', () => {
    const error = new KaneoApiError('GET /api/activity/abc returned 404', 404, {
      error: 'Not found',
    })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('comment-not-found')
  })

  test('returns relationNotFound for 404 with task-relation path', () => {
    const error = new KaneoApiError('GET /api/task-relation/task-1 returned 404', 404, {
      error: 'Not found',
    })
    const result = classifyKaneoError(error, { taskId: 'task-1' })
    expect(result.appError.code).toBe('relation-not-found')
  })

  test('returns unknown for 404 without recognisable resource context', () => {
    const error = new KaneoApiError('Not found', 404, { error: 'Not found' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('unknown')
  })

  test('returns rateLimited for 429', () => {
    const error = new KaneoApiError('Too many requests', 429, { error: 'Rate limited' })
    const result = classifyKaneoError(error)
    expect(result.appError).toEqual(providerError.rateLimited())
  })

  test('returns rateLimited for generic error with rate limit message', () => {
    const error = new Error('Rate limit exceeded, try again later')
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('rate-limited')
  })

  test('returns rateLimited for error message containing 429', () => {
    const error = new Error('Error 429: Rate limited')
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('rate-limited')
  })

  test('returns validationFailed for 400', () => {
    const error = new KaneoApiError('Bad request', 400, { error: 'Bad request' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('validation-failed')
  })

  test('returns unexpected for 500 server error', () => {
    const error = new KaneoApiError('Internal server error', 500, { error: 'Server error' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('unexpected')
  })

  test('returns unexpected for gateway errors', () => {
    const error = new KaneoApiError('Bad Gateway', 502, { error: 'Gateway error' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('unexpected')
  })

  test('returns authFailed for auth message without status', () => {
    const error = new Error('Unauthorized access')
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('auth-failed')
  })

  test('returns already classified errors unchanged', () => {
    const classified = new KaneoClassifiedError('test', providerError.taskNotFound('task-1'))
    const result = classifyKaneoError(classified)
    expect(result).toBe(classified)
    expect(result.appError).toEqual(providerError.taskNotFound('task-1'))
  })

  test('handles non-Error objects', () => {
    const result = classifyKaneoError('string error')
    expect(result.appError.code).toBe('unexpected')
  })

  test('handles null error', () => {
    const result = classifyKaneoError(null)
    expect(result.appError.code).toBe('unexpected')
  })

  test('handles KaneoApiError with statusCode', () => {
    const error = new KaneoApiError('Task not found', 404, { error: 'Not found' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('task-not-found')
  })

  test('handles KaneoApiError with 401 status', () => {
    const error = new KaneoApiError('Unauthorized', 401, { error: 'Unauthorized' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('auth-failed')
  })

  test('handles KaneoApiError with 429 status', () => {
    const error = new KaneoApiError('Rate limited', 429, { error: 'Rate limited' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('rate-limited')
  })

  test('handles KaneoApiError with 400 status', () => {
    const error = new KaneoApiError('Bad request', 400, { error: 'Invalid input' })
    const result = classifyKaneoError(error)
    expect(result.appError.code).toBe('validation-failed')
  })

  test('handles undefined error', () => {
    const result = classifyKaneoError(undefined)
    expect(result.appError.code).toBe('unexpected')
  })

  describe('with context parameter', () => {
    test('preserves taskId in 404 task-not-found error', () => {
      const error = new KaneoApiError('Task not found', 404, { error: 'Not found' })
      const result = classifyKaneoError(error, { taskId: 'TASK-123' })
      expect(result.appError.code).toBe('task-not-found')
      expect(result.appError).toHaveProperty('taskId', 'TASK-123')
    })

    test('preserves projectId in 404 project-not-found error', () => {
      const error = new KaneoApiError('Project not found', 404, { error: 'Not found' })
      const result = classifyKaneoError(error, { projectId: 'PROJ-456' })
      expect(result.appError.code).toBe('project-not-found')
      expect(result.appError).toHaveProperty('projectId', 'PROJ-456')
    })

    test('preserves commentId in 404 comment-not-found error', () => {
      const error = new KaneoApiError('Comment not found', 404, { error: 'Not found' })
      const result = classifyKaneoError(error, { commentId: 'COMM-789' })
      expect(result.appError.code).toBe('comment-not-found')
      expect(result.appError).toHaveProperty('commentId', 'COMM-789')
    })

    test('preserves labelName in 404 label-not-found error', () => {
      const error = new KaneoApiError('Label not found', 404, { error: 'Not found' })
      const result = classifyKaneoError(error, { labelName: 'urgent' })
      expect(result.appError.code).toBe('label-not-found')
      expect(result.appError).toHaveProperty('labelName', 'urgent')
    })

    test('uses unknown as fallback when no context provided', () => {
      const error = new KaneoApiError('Task not found', 404, { error: 'Not found' })
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('task-not-found')
      expect(result.appError).toHaveProperty('taskId', 'unknown')
    })
  })

  describe('network error detection', () => {
    test('detects TypeError with fetch failed message', () => {
      const error = new TypeError('fetch failed')
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects TypeError with ECONNREFUSED', () => {
      const error = new TypeError('connect ECONNREFUSED 127.0.0.1:11337')
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects TypeError with ENOTFOUND', () => {
      const error = new TypeError('getaddrinfo ENOTFOUND api.example.com')
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects Error with network in message', () => {
      const error = new Error('Network request failed')
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects Error with connect in message', () => {
      const error = new Error('Failed to connect to server')
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('network-error')
    })
  })

  describe('malformed response handling', () => {
    test('returns invalid-response for KaneoValidationError', () => {
      const error = new KaneoValidationError('Invalid response data', {
        issues: [{ path: ['id'] }],
      })
      const result = classifyKaneoError(error)
      expect(result.appError.code).toBe('invalid-response')
    })
  })
})
