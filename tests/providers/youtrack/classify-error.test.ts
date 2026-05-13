import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getUserMessage, providerError, systemError } from '../../../src/errors.js'
import { classifyYouTrackError, YouTrackClassifiedError } from '../../../src/providers/youtrack/classify-error.js'
import { YouTrackApiError } from '../../../src/providers/youtrack/client.js'

describe('classifyYouTrackError', () => {
  describe('HTTP status code classification', () => {
    test('returns authFailed for 401', () => {
      const error = new YouTrackApiError('Unauthorized', 401, {})
      const result = classifyYouTrackError(error)
      expect(result.appError).toEqual(providerError.authFailed())
    })

    test('returns authFailed for 403', () => {
      const error = new YouTrackApiError('Forbidden', 403, {})
      const result = classifyYouTrackError(error)
      expect(result.appError).toEqual(providerError.authFailed())
    })

    test('returns rateLimited for 429', () => {
      const error = new YouTrackApiError('Too many requests', 429, {})
      const result = classifyYouTrackError(error)
      expect(result.appError).toEqual(providerError.rateLimited())
    })

    test('returns taskNotFound for 404 with issue in message', () => {
      const error = new YouTrackApiError('Issue not found', 404, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('task-not-found')
    })

    test('returns projectNotFound for 404 with project in message', () => {
      const error = new YouTrackApiError('Project not found', 404, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('project-not-found')
    })

    test('returns commentNotFound for 404 with comment in message', () => {
      const error = new YouTrackApiError('Comment not found', 404, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('comment-not-found')
    })

    test('returns labelNotFound for 404 with tag in message', () => {
      const error = new YouTrackApiError('Tag not found', 404, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('label-not-found')
    })

    test('returns notFound for 404 with saved query in message', () => {
      const error = new YouTrackApiError('Saved query not found', 404, {})
      const result = classifyYouTrackError(error, { queryId: 'query-404' })
      expect(result.appError).toEqual(providerError.notFound('Saved query', 'query-404'))
    })

    test('returns unknown for 404 without recognisable resource type', () => {
      const error = new YouTrackApiError('Not found', 404, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('unknown')
    })

    test('returns validationFailed for 400', () => {
      const error = new YouTrackApiError('Bad request', 400, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('validation-failed')
    })

    test('returns unexpected for 500 server error', () => {
      const error = new YouTrackApiError('Internal Server Error', 500, {})
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('unexpected')
    })
  })

  describe('with context parameter', () => {
    test('preserves taskId in 404 task-not-found error', () => {
      const error = new YouTrackApiError('Issue not found', 404, {})
      const result = classifyYouTrackError(error, { taskId: 'PROJ-42' })
      expect(result.appError.code).toBe('task-not-found')
      expect(result.appError).toHaveProperty('taskId', 'PROJ-42')
      expect(getUserMessage(result.appError)).toContain('PROJ-42')
    })

    test('preserves projectId in 404 project-not-found error', () => {
      const error = new YouTrackApiError('Project not found', 404, {})
      const result = classifyYouTrackError(error, { projectId: 'MY-PROJECT' })
      expect(result.appError.code).toBe('project-not-found')
      expect(result.appError).toHaveProperty('projectId', 'MY-PROJECT')
    })

    test('preserves commentId in 404 comment-not-found error', () => {
      const error = new YouTrackApiError('Comment not found', 404, {})
      const result = classifyYouTrackError(error, { commentId: 'COMMENT-1' })
      expect(result.appError.code).toBe('comment-not-found')
      expect(result.appError).toHaveProperty('commentId', 'COMMENT-1')
    })

    test('preserves labelId in 404 label-not-found error', () => {
      const error = new YouTrackApiError('Tag not found', 404, {})
      const result = classifyYouTrackError(error, { labelId: 'TAG-99' })
      expect(result.appError.code).toBe('label-not-found')
      expect(result.appError).toHaveProperty('labelName', 'TAG-99')
    })

    test('falls back to unknown when no context provided for 404', () => {
      const error = new YouTrackApiError('Issue not found', 404, {})
      const result = classifyYouTrackError(error)
      expect(result.appError).toHaveProperty('taskId', 'unknown')
    })
  })

  describe('network error detection', () => {
    test('detects TypeError with fetch failed message', () => {
      const error = new TypeError('fetch failed')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects TypeError with ECONNREFUSED', () => {
      const error = new TypeError('connect ECONNREFUSED 127.0.0.1:8080')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects TypeError with ENOTFOUND', () => {
      const error = new TypeError('getaddrinfo ENOTFOUND youtrack.example.com')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects Error with network in message', () => {
      const error = new Error('Network request failed')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('detects Error with connect in message', () => {
      const error = new Error('Failed to connect to server')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('network-error')
    })

    test('getUserMessage for network-error has user-friendly text', () => {
      const result = classifyYouTrackError(new TypeError('fetch failed'))
      const message = getUserMessage(result.appError)
      expect(message.toLowerCase()).toMatch(/unavailable|connection/)
    })
  })

  describe('generic error handling', () => {
    test('returns authFailed for Error with unauthorized message', () => {
      const error = new Error('Unauthorized access')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('auth-failed')
    })

    test('returns rateLimited for Error with rate limit message', () => {
      const error = new Error('Rate limit exceeded')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('rate-limited')
    })

    test('returns unexpected for plain Error', () => {
      const error = new Error('Something went wrong')
      const result = classifyYouTrackError(error)
      expect(result.appError.code).toBe('unexpected')
    })

    test('handles null error gracefully', () => {
      const result = classifyYouTrackError(null)
      expect(result.appError.code).toBe('unexpected')
    })

    test('handles undefined error gracefully', () => {
      const result = classifyYouTrackError(undefined)
      expect(result.appError.code).toBe('unexpected')
    })

    test('handles string error gracefully', () => {
      const result = classifyYouTrackError('something went wrong')
      expect(result.appError.code).toBe('unexpected')
    })
  })

  describe('returns YouTrackClassifiedError', () => {
    test('result is an instance of YouTrackClassifiedError', () => {
      const error = new YouTrackApiError('Issue not found', 404, {})
      const result = classifyYouTrackError(error, { taskId: 'T-1' })
      expect(result).toBeInstanceOf(YouTrackClassifiedError)
      expect(result).toBeInstanceOf(Error)
    })

    test('preserves already classified errors', () => {
      const original = new YouTrackClassifiedError('Already classified', providerError.taskNotFound('T-1'))
      const result = classifyYouTrackError(original)
      expect(result).toBe(original)
    })

    test('carries appError payload with getUserMessage support', () => {
      const error = new YouTrackApiError('Issue not found', 404, {})
      const classified = classifyYouTrackError(error, { taskId: 'PROJ-99' })
      const message = getUserMessage(classified.appError)
      expect(message).toContain('PROJ-99')
      expect(message).toContain('not found')
    })
  })

  describe('workflow validation errors', () => {
    test('classifies 400 with error_type workflow as workflow-validation-failed', () => {
      const error = new YouTrackApiError('Bad request', 400, {
        error: 'Assertion failed',
        error_description: 'Please fill in "URL address" or "Service Discovery name".',
        error_type: 'workflow',
      })
      const result = classifyYouTrackError(error, { projectId: 'PROJ-1' })
      assert.equal(result.appError.code, 'workflow-validation-failed')
      expect(result.appError.requiredFields.length).toBeGreaterThan(0)
    })

    test('extracts quoted field names from Russian workflow error', () => {
      const error = new YouTrackApiError('Bad request', 400, {
        error: 'Assertion failed',
        error_description:
          '\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 "URL \u0430\u0434\u0435\u0441\u0430 \u0433\u0434\u0435 \u0431\u0443\u0434\u0435\u0442 \u0440\u0430\u0437\u043C\u0435\u0449\u0430\u0442\u044C\u0441\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438" (\u0441 \u0443\u043A\u0430\u0437\u0430\u043D\u0438\u0435\u043C \u043F\u0440\u043E\u0442\u043E\u043A\u043E\u043B\u0430 http(s)://) \u0438\u043B\u0438 "\u0418\u043C\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0432 Service Discovery".',
        error_type: 'workflow',
      })
      const result = classifyYouTrackError(error, { projectId: '39-1118' })
      assert.equal(result.appError.code, 'workflow-validation-failed')
      const fieldNames = result.appError.requiredFields.map((f) => f.name)
      expect(fieldNames).toContain('URL адеса где будет размещаться приложени')
      expect(fieldNames).toContain('Имя приложения в Service Discovery')
    })

    test('extracts quoted field names with smart quotes', () => {
      const error = new YouTrackApiError('Bad request', 400, {
        error: 'Assertion failed',
        error_description:
          '\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u00ABURL\u00BB \u0438\u043B\u0438 \u00ABName\u00BB.',
        error_type: 'workflow',
      })
      const result = classifyYouTrackError(error)
      assert.equal(result.appError.code, 'workflow-validation-failed')
      const fieldNames = result.appError.requiredFields.map((f) => f.name)
      expect(fieldNames).toContain('URL')
      expect(fieldNames).toContain('Name')
    })
  })

  describe('user-friendly messages', () => {
    test('task-not-found includes taskId', () => {
      const error = new YouTrackApiError('Issue not found', 404, {})
      const result = classifyYouTrackError(error, { taskId: 'PROJ-123' })
      const message = getUserMessage(result.appError)
      expect(message).toContain('PROJ-123')
    })

    test('auth-failed has descriptive message', () => {
      const error = new YouTrackApiError('Unauthorized', 401, {})
      const result = classifyYouTrackError(error)
      const message = getUserMessage(result.appError)
      expect(message.toLowerCase()).toMatch(/api key|connect/)
    })

    test('network-error message mentions retry', () => {
      const result = classifyYouTrackError(new TypeError('fetch failed'))
      const message = getUserMessage(result.appError)
      expect(message.toLowerCase()).toContain('try again')
    })

    test('network-error message is from systemError', () => {
      const result = classifyYouTrackError(new TypeError('fetch failed'))
      expect(result.appError).toEqual(systemError.networkError('fetch failed'))
    })
  })
})
