// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { taskInstances } from '../../src/db/schema.js'
import { getContextSettings } from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  handleTaskInstanceSelectionMessage,
  startTaskInstanceSelection,
} from '../../src/setup/task-instance-selection.js'
import type { TaskInstanceSelectionResult } from '../../src/setup/task-instance-selection.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const SCOPED_CTX_1 = 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:Y3R4LTE'

const expectPending = (
  result: TaskInstanceSelectionResult,
): Extract<TaskInstanceSelectionResult, { status: 'pending' }> => {
  if (result.status !== 'pending') throw new Error(`Expected pending, got ${result.status}`)
  return result
}

describe('task instance setup selection', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '6'.repeat(64)
    process.env['CHAT_PROVIDER'] = 'telegram'
  })

  test('aborts when there are no active task instances', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-default')

    expect(result).toEqual({
      status: 'aborted',
      response: 'No task trackers are configured. Ask a super-admin to add one in the dashboard.',
    })
  })

  test('auto-assigns the only active task instance', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-default')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
    expect(getContextSettings(SCOPED_CTX_1)).toEqual({
      contextId: SCOPED_CTX_1,
      taskInstanceId: 'yt-prod',
      platformInstanceId: 'telegram-default',
    })
  })

  test('auto-assignment persists the source platform instance when multiple active platforms share a type', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't1' }, status: 'active' })
    insertPlatformInstance({ id: 'telegram-secondary', type: 'telegram', config: { token: 't2' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-secondary')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
    expect(getContextSettings(SCOPED_CTX_1)).toEqual({
      contextId: SCOPED_CTX_1,
      taskInstanceId: 'yt-prod',
      platformInstanceId: 'telegram-secondary',
    })
  })

  test('asks the user to choose when multiple active task instances exist', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-default')

    expect(result.status).toBe('pending')
    const pending = expectPending(result)
    expect(pending.response).toContain('Choose a task tracker for this context')
    expect(pending.response).toContain('kaneo-prod')
    expect(pending.response).toContain('yt-prod')
    expect(getContextSettings(SCOPED_CTX_1)).toBeNull()
  })

  test('handles text selection by task instance id', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-default')

    const result = handleTaskInstanceSelectionMessage('user-1', SCOPED_CTX_1, 'yt-prod')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
    expect(getContextSettings(SCOPED_CTX_1)).toEqual({
      contextId: SCOPED_CTX_1,
      taskInstanceId: 'yt-prod',
      platformInstanceId: 'telegram-default',
    })
  })

  test('manual selection persists the platform instance from the selection session', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't1' }, status: 'active' })
    insertPlatformInstance({ id: 'telegram-secondary', type: 'telegram', config: { token: 't2' }, status: 'active' })
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-secondary')

    const result = handleTaskInstanceSelectionMessage('user-1', SCOPED_CTX_1, 'yt-prod')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
    expect(getContextSettings(SCOPED_CTX_1)).toEqual({
      contextId: SCOPED_CTX_1,
      taskInstanceId: 'yt-prod',
      platformInstanceId: 'telegram-secondary',
    })
  })

  test('degrades gracefully when a task_instances row is undecryptable', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    getDrizzleDb()
      .insert(taskInstances)
      .values({ id: 'bad-task', type: 'kaneo', config: 'not-base64', status: 'active' })
      .run()

    const result = startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-default')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
  })

  test('rejects text selection that is not one of the active options', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    insertTaskInstance({
      id: 'old-prod',
      type: 'youtrack',
      config: { baseUrl: 'https://old.invalid' },
      status: 'stopped',
    })
    startTaskInstanceSelection('user-1', SCOPED_CTX_1, 'telegram-default')

    const result = handleTaskInstanceSelectionMessage('user-1', SCOPED_CTX_1, 'old-prod')

    expect(result.status).toBe('pending')
    const pending = expectPending(result)
    expect(pending.response).toContain('Reply with one of these task instance IDs')
    expect(getContextSettings(SCOPED_CTX_1)).toBeNull()
  })
})
