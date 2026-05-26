// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('bot-auto-setup', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  test('autoStartWizardIfNeeded returns false (no wizard) for a contributed provider type', async () => {
    const { autoStartWizardIfNeeded } = await import('../src/bot-auto-setup.js')
    insertTaskInstance({
      id: 'demo-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'demo-1', platformInstanceId: 'telegram-default' })

    const { reply, textCalls } = createMockReply()
    const result = await autoStartWizardIfNeeded('user-1', 'ctx-1', 'telegram-default', reply)

    // Contributed providers have no wizard steps — nothing to prompt
    expect(result).toBe(false)
    expect(textCalls).toHaveLength(0)
  })
})
