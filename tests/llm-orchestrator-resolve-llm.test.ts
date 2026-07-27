// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../src/db/drizzle.js'
import { llmAdminRoles } from '../src/db/schema.js'
import { resetBotMisconfiguredNotifiedForTesting, resolveLlmForTurn } from '../src/llm-orchestrator-resolve-llm.js'
import { clearLlmAdminCacheForTesting } from '../src/llm-providers/store.js'
import {
  createMockReply,
  mockLogger,
  seedAdminLlmBinding,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

const clearAdminLlmBinding = (): void => {
  getDrizzleDb().delete(llmAdminRoles).run()
  clearLlmAdminCacheForTesting()
}

describe('resolveLlmForTurn', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedAdminLlmBinding()
    resetBotMisconfiguredNotifiedForTesting()
  })

  test('returns the resolved config when admin bindings are present', async () => {
    const { reply, textCalls } = createMockReply()
    const result = await resolveLlmForTurn(reply, 'ctx', 'cfg-1')
    expect(result).not.toBeNull()
    expect(textCalls.length).toBe(0)
  })

  test('replies with admin-misconfigured message and returns null when admin bindings missing', async () => {
    clearAdminLlmBinding()
    const { reply, textCalls } = createMockReply()
    const result = await resolveLlmForTurn(reply, 'ctx', 'cfg-1')
    expect(result).toBeNull()
    expect(textCalls[0]).toContain('not fully configured')
    expect(textCalls[0]).toContain('/config')
  })

  test('resetBotMisconfiguredNotifiedForTesting resets the dedupe guard (idempotent)', () => {
    expect(() => resetBotMisconfiguredNotifiedForTesting()).not.toThrow()
    resetBotMisconfiguredNotifiedForTesting()
  })
})
