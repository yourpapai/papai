// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { isToolFailureResult } from '../../src/tool-failure.js'
import { makeApplyYouTrackCommandTool } from '../../src/tools/apply-youtrack-command.js'
import { wrapToolExecution } from '../../src/tools/wrap-tool-execution.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const expectConfirmationMessage = (result: unknown, text: string): void => {
  expect(result).toMatchObject({ status: 'confirmation_required' })
  expect(result).toBeObject()
  if (result === null || typeof result !== 'object' || !('message' in result) || typeof result.message !== 'string') {
    expect.unreachable('Expected confirmation result with a message string')
  }
  expect(result.message).toContain(text)
}

const expectToolFailureUserMessage = (result: unknown, text: string): void => {
  expect(result).toBeObject()
  if (
    result === null ||
    typeof result !== 'object' ||
    !('success' in result) ||
    result.success !== false ||
    ('status' in result && result.status === 'confirmation_required') ||
    !('userMessage' in result) ||
    typeof result.userMessage !== 'string'
  ) {
    expect.unreachable('Expected structured tool failure result with a userMessage string')
  }
  expect(result.userMessage).toContain(text)
}

const expectBulkValidationFailure = (result: unknown): void => {
  expect(isToolFailureResult(result)).toBe(true)
  expect(result).toMatchObject({
    success: false,
    errorType: 'provider',
    errorCode: 'validation-failed',
  })
  expectToolFailureUserMessage(result, 'bulk commands are disabled for safety')
  expectToolFailureUserMessage(result, 'structured tools')
  expectToolFailureUserMessage(result, 'one issue at a time')

  if (
    result === null ||
    typeof result !== 'object' ||
    !('details' in result) ||
    typeof result.details !== 'object' ||
    result.details === null
  ) {
    expect.unreachable('Expected structured tool failure result with validation details')
  }

  if (!('field' in result.details) || typeof result.details.field !== 'string') {
    expect.unreachable('Expected validation details.field to be a string')
  }

  if (!('reason' in result.details) || typeof result.details.reason !== 'string') {
    expect.unreachable('Expected validation details.reason to be a string')
  }

  expect(result.details.field).toBe('taskIds')
  expect(result.details.reason).toContain('bulk commands are disabled for safety')
  expect(result.details.reason).toContain('structured tools')
  expect(result.details.reason).toContain('one issue at a time')
  expect(result).not.toMatchObject({ status: 'confirmation_required' })
}

const executeWrappedTool = (tool: unknown, input: unknown): Promise<unknown> => {
  const execute = getToolExecutor(tool) as (
    input: unknown,
    options: { toolCallId: string; messages: unknown[] },
  ) => Promise<unknown>
  const wrappedExecute = wrapToolExecution(execute, 'apply_youtrack_command')
  return wrappedExecute(input, { toolCallId: 'call-1', messages: [] })
}

const getInputFieldDescription = (schema: unknown, fieldName: string): string | undefined => {
  if (!(schema instanceof z.ZodType)) return undefined
  const jsonSchema = z.toJSONSchema(schema)
  if (!('properties' in jsonSchema) || jsonSchema.properties === undefined) return undefined
  const property = jsonSchema.properties[fieldName]
  if (property === undefined || typeof property !== 'object' || property === null) return undefined
  return 'description' in property && typeof property.description === 'string' ? property.description : undefined
}

describe('apply_youtrack_command', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('requires query and taskIds', () => {
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const }))
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'for me', taskIds: ['TEST-1'] })).toBe(true)
    expect(schemaValidates(tool, { query: 'for me', taskIds: ['TEST-1', 'TEST-2'] })).toBe(true)
    expect(schemaValidates(tool, { query: 'delete', taskIds: ['TEST-1'], confidence: 0.9 })).toBe(true)
    expect(schemaValidates(tool, { query: '   ', taskIds: ['TEST-1'] })).toBe(false)
    expect(schemaValidates(tool, { query: 'for me', taskIds: ['TEST-1', '   '] })).toBe(false)
  })

  test('describes single-issue command usage', () => {
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const }))
    const taskIdsDescription = getInputFieldDescription(tool.inputSchema, 'taskIds')

    expect(tool.description).toContain('single YouTrack issue')
    expect(tool.description).not.toContain('one or more issues')
    expect(taskIdsDescription).toContain('Provide issue IDs as an array')
    expect(taskIdsDescription).toContain('Multi-issue requests are rejected for safety')
    expect(taskIdsDescription).toContain('single-issue use')
  })

  test('forwards the command payload to the provider after explicit confirmation for side effects', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], silent: true }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))
    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], silent: true, confidence: 1 })
    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], silent: true })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: true,
    })
  })

  test('returns confirmation_required for low-confidence single-issue silent commands', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], silent: true }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], silent: true, confidence: 0.6 })

    expectConfirmationMessage(result, 'without notifications')
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required for commands outside the safe allowlist without high confidence', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'State In Progress', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'State In Progress', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards commands outside the safe allowlist after explicit confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'State In Progress', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'State In Progress', taskIds: ['TEST-1'], confidence: 1 })

    expect(result).toEqual({ query: 'State In Progress', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'State In Progress',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })

  test('returns confirmation_required for delete commands without high confidence', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'delete', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards delete commands after explicit confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'delete', taskIds: ['TEST-1'], confidence: 1 })

    expect(result).toEqual({ query: 'delete', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'delete',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })

  test('returns confirmation_required when delete appears later in the command', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for me delete', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required for removal-style commands without high confidence', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'remove tag blocker', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'remove tag blocker', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required when tag is followed by another operation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'tag blocker delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'tag blocker delete',
      taskIds: ['TEST-1'],
      confidence: 0.6,
    })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required when untag is followed by another operation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'untag blocker delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'untag blocker delete',
      taskIds: ['TEST-1'],
      confidence: 0.6,
    })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns confirmation_required when comment is combined with another operation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'comment delete', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'comment delete',
      taskIds: ['TEST-1'],
      comment: 'Investigating now',
      confidence: 0.6,
    })

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('allows known-safe for-me commands without confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })

  test('requires confirmation when a safe command also adds a comment', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], comment: 'On it' }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'On it',
      confidence: 0.6,
    })

    expectConfirmationMessage(result, 'with a comment')
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure when a command targets multiple issues', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      confidence: 0.6,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure for high-confidence bulk input', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      confidence: 1,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure for low-confidence bulk delete instead of confirmation_required', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'delete', taskIds: ['TEST-1', 'TEST-2'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'delete',
      taskIds: ['TEST-1', 'TEST-2'],
      confidence: 0.6,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure for high-confidence bulk delete', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'delete', taskIds: ['TEST-1', 'TEST-2'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'delete',
      taskIds: ['TEST-1', 'TEST-2'],
      confidence: 1,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure for bulk input with a comment instead of confirmation_required', async () => {
    const applyCommand = mock(() =>
      Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'], comment: 'On it' }),
    )
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      comment: 'On it',
      confidence: 0.6,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure for high-confidence bulk input with a comment', async () => {
    const applyCommand = mock(() =>
      Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'], comment: 'On it' }),
    )
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      comment: 'On it',
      confidence: 1,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('returns a wrapped tool failure for low-confidence bulk delete with a comment instead of confirmation_required', async () => {
    const applyCommand = mock(() =>
      Promise.resolve({ query: 'delete', taskIds: ['TEST-1', 'TEST-2'], comment: 'On it' }),
    )
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await executeWrappedTool(tool, {
      query: 'delete',
      taskIds: ['TEST-1', 'TEST-2'],
      comment: 'On it',
      confidence: 0.6,
    })

    expectBulkValidationFailure(result)
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards a confirmed command that adds a comment', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], comment: 'On it' }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'On it',
      confidence: 1,
    })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], comment: 'On it' })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: 'On it',
      silent: undefined,
    })
  })

  test('allows exact single-user for commands without confirmation', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for jane.doe', taskIds: ['TEST-1'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({ query: 'for jane.doe', taskIds: ['TEST-1'], confidence: 0.6 })

    expect(result).toEqual({ query: 'for jane.doe', taskIds: ['TEST-1'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for jane.doe',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: undefined,
    })
  })
})
