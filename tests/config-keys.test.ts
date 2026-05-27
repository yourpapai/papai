// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getConfigKeysForContext } from '../src/config-keys.js'
import { setConfig, getAllConfig } from '../src/config.js'
import { taskInstances } from '../src/db/schema.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import {
  getTestDb,
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from './utils/test-helpers.js'

describe('getConfigKeysForContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  test('returns preferences only for an unassigned context', () => {
    expect(getConfigKeysForContext('ctx-unassigned')).toEqual(['timezone'])
  })

  test('returns Kaneo visible keys for an active Kaneo assignment', () => {
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-kaneo', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-kaneo')).toEqual(['kaneo_apikey', 'timezone'])
  })

  test('returns YouTrack visible keys for an active YouTrack assignment', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-yt')).toEqual(['youtrack_token', 'timezone'])
  })

  test('returns preferences only when deleted task instance cascades assignment removal', () => {
    seedTestTaskInstance({ id: 'missing' })
    setContextSettings({ contextId: 'ctx-missing', taskInstanceId: 'missing', platformInstanceId: 'telegram-default' })
    getTestDb().delete(taskInstances).where(eq(taskInstances.id, 'missing')).run()

    expect(getConfigKeysForContext('ctx-missing')).toEqual(['timezone'])
  })

  test('returns preferences only when assigned instance is inactive', () => {
    insertTaskInstance({ id: 'yt-stopped', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'stopped' })
    setContextSettings({
      contextId: 'ctx-stopped',
      taskInstanceId: 'yt-stopped',
      platformInstanceId: 'telegram-default',
    })

    expect(getConfigKeysForContext('ctx-stopped')).toEqual(['timezone'])
  })

  test('returns preferences only for an active contributed (non-builtin) assignment', () => {
    insertTaskInstance({
      id: 'demo-prod',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-demo', taskInstanceId: 'demo-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-demo')).toEqual(['timezone'])
  })

  test('getAllConfig only includes keys valid for the context', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-yt', 'kaneo_apikey', 'hidden-kaneo-key')
    setConfig('ctx-yt', 'youtrack_token', 'perm:abc')
    setConfig('ctx-yt', 'timezone', 'UTC')

    expect(getAllConfig('ctx-yt')).toEqual({ youtrack_token: 'perm:abc', timezone: 'UTC' })
  })
})
