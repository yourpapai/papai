// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { autoStartWizardIfNeeded } from '../src/bot-auto-setup.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import { createMockReply, mockLogger, seedCommonTestPlatformInstances, setupTestDb } from './utils/test-helpers.js'

describe('bot-auto-setup', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  test('autoStartWizardIfNeeded starts timezone wizard for a contributed provider type', async () => {
    insertTaskInstance({
      id: 'demo-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'demo-1', platformInstanceId: 'telegram-default' })

    const { reply, textCalls } = createMockReply()
    const result = await autoStartWizardIfNeeded('user-1', 'ctx-1', 'telegram-default', reply)

    // Contributed providers without credential fields still prompt for general preferences.
    expect(result).toBe(true)
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Enter your timezone')
  })
})
