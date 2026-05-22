// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard integration tests - Phase 1 two-step flow.
 * LLM credentials live in `system_config` (admin-owned) and no longer
 * appear in the user-facing wizard.
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfig } from '../../src/config.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const { createWizard, advanceStep, processWizardMessage } = await import('../../src/wizard/engine.js')
const { validateAndSaveWizardConfig } = await import('../../src/wizard/save.js')
const { hasActiveWizard, deleteWizardSession } = await import('../../src/wizard/state.js')

describe('Wizard Integration (Phase 1)', () => {
  const userId = 'test-user'
  const storageContextId = 'test-context'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await deleteWizardSession(userId, storageContextId)
  })

  test('completes the kaneo two-step flow and saves the config', async () => {
    const start = await createWizard(userId, storageContextId, 'kaneo')
    expect(start.success).toBe(true)
    expect(await hasActiveWizard(userId, storageContextId)).toBe(true)
    expect(start.prompt).toContain('🔑 Enter your Kaneo API key')

    const step1 = await advanceStep(userId, storageContextId, 'kaneo-token', true)
    expect(step1.success).toBe(true)
    expect(step1.prompt).toContain('🌍 Enter your timezone')

    const step2 = await advanceStep(userId, storageContextId, 'UTC', true)
    expect(step2.success).toBe(true)
    expect(step2.complete).toBe(true)
    expect(step2.prompt).toContain('Configuration Summary')
    expect(step2.prompt).toContain('Kaneo API Key')
    expect(step2.prompt).not.toContain('LLM API Key')

    const saveResult = await validateAndSaveWizardConfig(userId, storageContextId)
    expect(saveResult.success).toBe(true)
    expect(saveResult.message).toContain('Configuration saved successfully')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)

    expect(getConfig(storageContextId, 'kaneo_apikey')).toBe('kaneo-token')
    expect(getConfig(storageContextId, 'timezone')).toBe('UTC')
  })

  test('completes the youtrack two-step flow', async () => {
    const start = await createWizard(userId, storageContextId, 'youtrack')
    expect(start.success).toBe(true)
    expect(start.prompt).toContain('🔑 Enter your YouTrack token')

    await advanceStep(userId, storageContextId, 'perm:token', true)
    const step2 = await advanceStep(userId, storageContextId, 'America/New_York', true)
    expect(step2.complete).toBe(true)

    const saveResult = await validateAndSaveWizardConfig(userId, storageContextId)
    expect(saveResult.success).toBe(true)
    expect(getConfig(storageContextId, 'youtrack_token')).toBe('perm:token')
    expect(getConfig(storageContextId, 'timezone')).toBe('America/New_York')
  })

  test('processWizardMessage advances step by step', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    const result = await processWizardMessage(userId, storageContextId, 'kaneo-token')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('🌍 Enter your timezone')
  })

  test('cancel command cancels the wizard at any step', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(true)

    const result = await processWizardMessage(userId, storageContextId, 'cancel')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('cancelled')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)

    expect(getConfig(userId, 'kaneo_apikey')).toBeNull()
  })

  test('rejects empty kaneo_apikey and stays on the same step', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    const result = await advanceStep(userId, storageContextId, '')
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('API key cannot be empty')
    expect(result.prompt).toContain('Please try again')

    const session = await processWizardMessage(userId, storageContextId, 'valid-key')
    expect(session.handled).toBe(true)
    expect(session.response).toContain('🌍 Enter your timezone')
  })

  test('rejects invalid timezone', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    await advanceStep(userId, storageContextId, 'kaneo-token', true)

    const result = await advanceStep(userId, storageContextId, 'not-a-tz')
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('Invalid timezone')
  })

  test('confirm command saves the config', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    await advanceStep(userId, storageContextId, 'kaneo-token', true)
    await advanceStep(userId, storageContextId, 'UTC', true)

    const result = await processWizardMessage(userId, storageContextId, 'confirm')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('Configuration saved successfully')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)
  })

  test('case-insensitive cancel handling', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    const result = await processWizardMessage(userId, storageContextId, 'CANCEL')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('cancelled')
  })

  test('processWizardMessage with no active wizard returns unhandled', async () => {
    const result = await processWizardMessage(userId, storageContextId, 'hello')
    expect(result.handled).toBe(false)
  })

  test('isolates sessions between users', async () => {
    const userId1 = 'user-1'
    const userId2 = 'user-2'

    await createWizard(userId1, storageContextId, 'kaneo')
    await createWizard(userId2, storageContextId, 'kaneo')

    expect(await hasActiveWizard(userId1, storageContextId)).toBe(true)
    expect(await hasActiveWizard(userId2, storageContextId)).toBe(true)

    await processWizardMessage(userId1, storageContextId, 'cancel')

    expect(await hasActiveWizard(userId1, storageContextId)).toBe(false)
    expect(await hasActiveWizard(userId2, storageContextId)).toBe(true)

    await deleteWizardSession(userId2, storageContextId)
  })

  test('isolates sessions between contexts', async () => {
    const contextId1 = 'ctx-1'
    const contextId2 = 'ctx-2'

    await createWizard(userId, contextId1, 'kaneo')
    await createWizard(userId, contextId2, 'kaneo')

    expect(await hasActiveWizard(userId, contextId1)).toBe(true)
    expect(await hasActiveWizard(userId, contextId2)).toBe(true)

    await processWizardMessage(userId, contextId1, 'cancel')

    expect(await hasActiveWizard(userId, contextId1)).toBe(false)
    expect(await hasActiveWizard(userId, contextId2)).toBe(true)

    await deleteWizardSession(userId, contextId2)
  })
})
