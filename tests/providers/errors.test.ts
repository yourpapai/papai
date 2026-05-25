// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getProviderMessage, providerError } from '../../src/providers/errors.js'

describe('getProviderMessage', () => {
  test('returns message for task-not-found', () => {
    const error = providerError.taskNotFound('task-123')
    expect(getProviderMessage(error)).toContain('task-123')
    expect(getProviderMessage(error)).toContain('not found')
  })

  test('returns message for project-not-found', () => {
    const error = providerError.projectNotFound('proj-456')
    expect(getProviderMessage(error)).toContain('proj-456')
    expect(getProviderMessage(error)).toContain('not found')
  })

  test('returns message for workspace-not-found', () => {
    const error = providerError.workspaceNotFound('ws-789')
    expect(getProviderMessage(error)).toContain('Workspace configuration')
  })

  test('returns message for comment-not-found', () => {
    const error = providerError.commentNotFound('cmt-001')
    expect(getProviderMessage(error)).toContain('cmt-001')
  })

  test('returns message for label-not-found', () => {
    const error = providerError.labelNotFound('urgent')
    expect(getProviderMessage(error)).toContain('urgent')
  })

  test('returns message for relation-not-found', () => {
    const error = providerError.relationNotFound('task-1', 'task-2')
    expect(getProviderMessage(error)).toContain('task-1')
    expect(getProviderMessage(error)).toContain('task-2')
  })

  test('returns message for not-found', () => {
    const error = providerError.notFound('resource', 'res-123')
    expect(getProviderMessage(error)).toContain('resource')
    expect(getProviderMessage(error)).toContain('res-123')
  })

  test('returns message for auth-failed', () => {
    const error = providerError.authFailed()
    expect(getProviderMessage(error)).toContain('API key')
  })

  test('returns message for rate-limited', () => {
    const error = providerError.rateLimited()
    expect(getProviderMessage(error)).toContain('rate limit')
  })

  test('returns message for validation-failed', () => {
    const error = providerError.validationFailed('title', 'too short')
    expect(getProviderMessage(error)).toContain('title')
    expect(getProviderMessage(error)).toContain('too short')
  })

  test('returns message for workflow-validation-failed', () => {
    const error = providerError.workflowValidationFailed('proj-123', 'Missing URL field', [
      {
        name: 'URL адеса где будет размещаться приложени',
        description: 'Must include stream:// protocol',
      },
    ])
    expect(getProviderMessage(error)).toContain('proj-123')
    expect(getProviderMessage(error)).toContain('Missing URL field')
    expect(getProviderMessage(error)).toContain('URL адеса где будет размещаться приложени')
    expect(getProviderMessage(error)).not.toContain('customFields parameter')
  })

  test('returns message for unsupported-operation', () => {
    const error = providerError.unsupportedOperation('deleteTask')
    expect(getProviderMessage(error)).toContain('deleteTask')
  })

  test('returns message for status-not-found', () => {
    const error = providerError.statusNotFound('in-progress', ['todo', 'done'])
    expect(getProviderMessage(error)).toContain('in-progress')
    expect(getProviderMessage(error)).toContain('todo')
    expect(getProviderMessage(error)).toContain('done')
  })

  test('returns message for invalid-response', () => {
    const error = providerError.invalidResponse()
    expect(getProviderMessage(error)).toContain('unexpected response')
  })

  test('returns message for unknown', () => {
    const error = providerError.unknown(new Error('test'))
    expect(getProviderMessage(error)).toContain('error occurred')
  })
})
