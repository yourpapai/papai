// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getUserMessage, providerError, systemError } from '../src/errors.js'
import { ProviderClassifiedError } from '../src/providers/errors.js'
import { classifyKaneoError, KaneoClassifiedError } from '../src/providers/kaneo/classify-error.js'
import { KaneoApiError } from '../src/providers/kaneo/errors.js'

describe('Error handling in llm-orchestrator', () => {
  describe('classifyKaneoError with context', () => {
    test('classifies 404 with taskId context', () => {
      const error = new KaneoApiError('Task not found', 404, { error: 'Not found' })
      const classified = classifyKaneoError(error, { taskId: 'TASK-42' })

      expect(classified.appError.code).toBe('task-not-found')
      expect(classified.appError).toHaveProperty('taskId', 'TASK-42')
      expect(getUserMessage(classified.appError)).toContain('TASK-42')
    })

    test('classifies 404 with projectId context', () => {
      const error = new KaneoApiError('Project not found', 404, { error: 'Not found' })
      const classified = classifyKaneoError(error, { projectId: 'PROJ-99' })

      expect(classified.appError.code).toBe('project-not-found')
      expect(classified.appError).toHaveProperty('projectId', 'PROJ-99')
    })

    test('preserves already classified errors', () => {
      const original = new KaneoClassifiedError('Already classified', providerError.taskNotFound('T-1'))
      const result = classifyKaneoError(original)
      expect(result).toBe(original)
    })
  })

  describe('error message generation', () => {
    test('task-not-found includes taskId in message', () => {
      const error = providerError.taskNotFound('TASK-123')
      const message = getUserMessage(error)
      expect(message).toContain('TASK-123')
      expect(message).toContain('not found')
    })

    test('project-not-found includes projectId in message', () => {
      const error = providerError.projectNotFound('PROJ-456')
      const message = getUserMessage(error)
      expect(message).toContain('PROJ-456')
      expect(message).toContain('not found')
    })

    test('status-not-found lists available options', () => {
      const error = providerError.statusNotFound('Review', ['To Do', 'In Progress', 'Done'])
      const message = getUserMessage(error)
      expect(message).toContain('Review')
      expect(message).toContain('To Do')
      expect(message).toContain('In Progress')
      expect(message).toContain('Done')
    })

    test('invalid-response has user-friendly message', () => {
      const error = providerError.invalidResponse()
      const message = getUserMessage(error)
      expect(message).toContain('unexpected response')
      expect(message).not.toContain('Zod')
      expect(message).not.toContain('schema')
    })

    test('network-error has user-friendly message', () => {
      const error = systemError.networkError('Connection refused')
      const message = getUserMessage(error)
      expect(message.toLowerCase()).toMatch(/unavailable|connection/u)
    })
  })

  describe('ProviderClassifiedError compatibility', () => {
    test('can wrap ProviderError in ProviderClassifiedError', () => {
      const providerErr = providerError.taskNotFound('T-1')
      const classified = new ProviderClassifiedError('Task lookup failed', providerErr)

      expect(classified.error).toEqual(providerErr)
      expect(getUserMessage(classified.error)).toContain('T-1')
    })

    test('KaneoClassifiedError carries AppError', () => {
      const appErr = systemError.networkError('Timeout')
      const classified = new KaneoClassifiedError('Network failed', appErr)

      expect(classified.appError).toEqual(appErr)
      expect(classified.appError.code).toBe('network-error')
    })
  })

  describe('error classification edge cases', () => {
    test('handles null error gracefully', () => {
      const result = classifyKaneoError(null)
      expect(result.appError.code).toBe('unexpected')
    })

    test('handles undefined error gracefully', () => {
      const result = classifyKaneoError(undefined)
      expect(result.appError.code).toBe('unexpected')
    })

    test('handles string error gracefully', () => {
      const result = classifyKaneoError('something went wrong')
      expect(result.appError.code).toBe('unexpected')
    })

    test('handles plain Error object', () => {
      const result = classifyKaneoError(new Error('Generic error'))
      expect(result.appError.code).toBe('unexpected')
    })
  })
})
