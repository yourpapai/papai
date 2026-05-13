import { describe, expect, test } from 'bun:test'

import { providerError, systemError, isAppError, getUserMessage, webFetchError } from '../src/errors.js'
import { llmError, validationError } from './utils/test-errors.js'

describe('providerError basic constructors', () => {
  test('taskNotFound creates correct structure', () => {
    const error = providerError.taskNotFound('task-123')
    expect(error).toEqual({
      type: 'provider',
      code: 'task-not-found',
      taskId: 'task-123',
    })
  })

  test('workspaceNotFound creates correct structure', () => {
    const error = providerError.workspaceNotFound('ws-456')
    expect(error).toEqual({
      type: 'provider',
      code: 'workspace-not-found',
      workspaceId: 'ws-456',
    })
  })

  test('authFailed creates correct structure', () => {
    const error = providerError.authFailed()
    expect(error).toEqual({
      type: 'provider',
      code: 'auth-failed',
    })
  })

  test('rateLimited creates correct structure', () => {
    const error = providerError.rateLimited()
    expect(error).toEqual({
      type: 'provider',
      code: 'rate-limited',
    })
  })
})

describe('providerError advanced constructors', () => {
  test('validationFailed creates correct structure', () => {
    const error = providerError.validationFailed('title', 'Title is required')
    expect(error).toEqual({
      type: 'provider',
      code: 'validation-failed',
      field: 'title',
      reason: 'Title is required',
    })
  })

  test('labelNotFound creates correct structure', () => {
    const error = providerError.labelNotFound('urgent')
    expect(error).toEqual({
      type: 'provider',
      code: 'label-not-found',
      labelName: 'urgent',
    })
  })

  test('unsupportedOperation creates correct structure', () => {
    const error = providerError.unsupportedOperation('archiveTask')
    expect(error).toEqual({
      type: 'provider',
      code: 'unsupported-operation',
      operation: 'archiveTask',
    })
  })

  test('unknown creates correct structure', () => {
    const originalError = new Error('Something went wrong')
    const error = providerError.unknown(originalError)
    expect(error.type).toBe('provider')
    expect(error.code).toBe('unknown')
    expect(error).toHaveProperty('originalError', originalError)
  })
})

describe('llmError constructors', () => {
  test('apiError creates correct structure', () => {
    const error = llmError.apiError('Connection timeout')
    expect(error).toEqual({
      type: 'llm',
      code: 'api-error',
      message: 'Connection timeout',
    })
  })

  test('rateLimited creates correct structure', () => {
    const error = llmError.rateLimited()
    expect(error).toEqual({ type: 'llm', code: 'rate-limited' })
  })

  test('timeout creates correct structure', () => {
    const error = llmError.timeout()
    expect(error).toEqual({ type: 'llm', code: 'timeout' })
  })

  test('tokenLimit creates correct structure', () => {
    const error = llmError.tokenLimit()
    expect(error).toEqual({ type: 'llm', code: 'token-limit' })
  })
})

describe('validationError constructors', () => {
  test('invalidInput creates correct structure', () => {
    const error = validationError.invalidInput('email', 'Invalid format')
    expect(error).toEqual({
      type: 'validation',
      code: 'invalid-input',
      field: 'email',
      reason: 'Invalid format',
    })
  })

  test('missingRequired creates correct structure', () => {
    const error = validationError.missingRequired('api_key')
    expect(error).toEqual({
      type: 'validation',
      code: 'missing-required',
      field: 'api_key',
    })
  })
})

describe('systemError constructors', () => {
  test('configMissing creates correct structure', () => {
    const error = systemError.configMissing('KANEO_KEY')
    expect(error).toEqual({
      type: 'system',
      code: 'config-missing',
      variable: 'KANEO_KEY',
    })
  })

  test('networkError creates correct structure', () => {
    const error = systemError.networkError('Connection refused')
    expect(error).toEqual({
      type: 'system',
      code: 'network-error',
      message: 'Connection refused',
    })
  })

  test('unexpected creates correct structure', () => {
    const originalError = new Error('Unexpected failure')
    const error = systemError.unexpected(originalError)
    expect(error.type).toBe('system')
    expect(error.code).toBe('unexpected')
    expect(error).toHaveProperty('originalError', originalError)
  })
})

describe('webFetchError constructors', () => {
  test('invalidUrl creates correct structure', () => {
    expect(webFetchError.invalidUrl()).toEqual({ type: 'web-fetch', code: 'invalid-url' })
  })

  test('upstreamError captures optional status', () => {
    expect(webFetchError.upstreamError(502)).toEqual({
      type: 'web-fetch',
      code: 'upstream-error',
      status: 502,
    })
  })
})

describe('isAppError type guard', () => {
  test('returns true for all valid error types', () => {
    expect(isAppError(providerError.authFailed())).toBe(true)
    expect(isAppError(llmError.timeout())).toBe(true)
    expect(isAppError(validationError.missingRequired('field'))).toBe(true)
    expect(isAppError(systemError.configMissing('VAR'))).toBe(true)
    expect(isAppError(webFetchError.blockedHost())).toBe(true)
  })

  test('returns false for non-AppError values', () => {
    expect(isAppError(new Error('test'))).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError(undefined)).toBe(false)
    expect(isAppError('error')).toBe(false)
    expect(isAppError(42)).toBe(false)
    expect(isAppError({})).toBe(false)
    expect(isAppError({ code: 'error' })).toBe(false)
    expect(isAppError({ type: 'invalid' })).toBe(false)
  })

  test('returns false for legacy kaneo type', () => {
    expect(isAppError({ type: 'kaneo', code: 'auth-failed' })).toBe(false)
  })
})

describe('getUserMessage for provider errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(providerError.taskNotFound('task-123'))).toContain('task-123')
    expect(getUserMessage(providerError.workspaceNotFound('ws-1'))).toContain('Workspace configuration')
    expect(getUserMessage(providerError.authFailed())).toContain('Failed to connect')
    expect(getUserMessage(providerError.rateLimited())).toContain('rate limit')
    expect(getUserMessage(providerError.validationFailed('title', 'too short'))).toContain('title')
    expect(getUserMessage(providerError.labelNotFound('bug'))).toContain('bug')
    expect(getUserMessage(providerError.unsupportedOperation('archiveTask'))).toContain('not supported')
    expect(getUserMessage(providerError.unknown(new Error('test')))).toContain('error occurred')
  })
})

describe('getUserMessage for llm errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(llmError.apiError('timeout'))).toContain('timeout')
    expect(getUserMessage(llmError.rateLimited())).toContain('rate limit')
    expect(getUserMessage(llmError.timeout())).toContain('timed out')
    expect(getUserMessage(llmError.tokenLimit())).toContain('too long')
  })
})

describe('getUserMessage for validation errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(validationError.invalidInput('email', 'bad'))).toContain('email')
    expect(getUserMessage(validationError.missingRequired('name'))).toContain('name')
  })
})

describe('getUserMessage for system errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(systemError.configMissing('API_KEY'))).toContain('API_KEY')
    expect(getUserMessage(systemError.networkError('timeout'))).toContain('timeout')
    expect(getUserMessage(systemError.unexpected(new Error('oops')))).toContain('unexpected')
  })
})

describe('getUserMessage for web fetch errors', () => {
  test('returns appropriate message for each error code', () => {
    expect(getUserMessage(webFetchError.invalidUrl())).toContain("doesn't look valid")
    expect(getUserMessage(webFetchError.blockedHost())).toContain('public web')
    expect(getUserMessage(webFetchError.blockedContentType())).toContain("isn't supported")
    expect(getUserMessage(webFetchError.tooLarge())).toContain('too large')
    expect(getUserMessage(webFetchError.timeout())).toContain('too long')
    expect(getUserMessage(webFetchError.rateLimited())).toContain('too quickly')
    expect(getUserMessage(webFetchError.extractFailed())).toContain("couldn't extract")
    expect(getUserMessage(webFetchError.upstreamError(502))).toContain('returned an error')
  })
})

describe('getUserMessage for missing provider error codes', () => {
  test('returns correct message for projectNotFound', () => {
    expect(getUserMessage(providerError.projectNotFound('proj-1'))).toContain('proj-1')
    expect(getUserMessage(providerError.projectNotFound('proj-1'))).toContain('not found')
  })

  test('returns correct message for commentNotFound', () => {
    expect(getUserMessage(providerError.commentNotFound('cmt-1'))).toContain('cmt-1')
    expect(getUserMessage(providerError.commentNotFound('cmt-1'))).toContain('not found')
  })

  test('returns correct message for relationNotFound', () => {
    const msg = getUserMessage(providerError.relationNotFound('t-1', 't-2'))
    expect(msg).toContain('t-1')
    expect(msg).toContain('t-2')
  })

  test('returns correct message for statusNotFound', () => {
    const msg = getUserMessage(providerError.statusNotFound('in-progress', ['to-do', 'done']))
    expect(msg).toContain('in-progress')
    expect(msg).toContain('to-do')
  })

  test('returns correct message for invalidResponse', () => {
    expect(getUserMessage(providerError.invalidResponse())).toContain('unexpected response')
  })
})
