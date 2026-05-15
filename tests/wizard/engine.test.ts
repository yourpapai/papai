// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard integration tests - full flow testing from creation to completion
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getConfig } from '../../src/config.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../utils/test-helpers.js'

// Dynamic imports to ensure mock is applied before module loading
const { createWizard, advanceStep, processWizardMessage } = await import('../../src/wizard/engine.js')
const { validateAndSaveWizardConfig } = await import('../../src/wizard/save.js')
const { hasActiveWizard, deleteWizardSession } = await import('../../src/wizard/state.js')

// Global fetch mock for integration tests (returns success by default)
describe('Wizard Integration', () => {
  const userId = 'test-user'
  const storageContextId = 'test-context'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await deleteWizardSession(userId, storageContextId)
    // Reset fetch to return success by default
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'gpt-4' }, { id: 'gpt-3.5' }, { id: 'gpt-3.5-turbo' }],
          }),
          { status: 200, statusText: 'OK' },
        ),
      ),
    )
  })

  afterEach(() => {
    restoreFetch()
  })

  test('should complete full wizard flow', async () => {
    // Start wizard
    const startResult = await createWizard(userId, storageContextId, 'kaneo')
    expect(startResult.success).toBe(true)
    expect(await hasActiveWizard(userId, storageContextId)).toBe(true)
    expect(startResult.prompt).toContain('Welcome to papai configuration')
    expect(startResult.prompt).toContain('🔑 Enter your LLM API key:')

    // Complete all steps - Kaneo has 7 steps total
    // Step 1: LLM API Key
    const step1 = await advanceStep(userId, storageContextId, 'sk-api-key', true)
    expect(step1.success).toBe(true)
    expect(step1.prompt).toContain('🌐 Enter base URL')

    // Step 2: Base URL
    const step2 = await advanceStep(userId, storageContextId, 'https://api.openai.com/v1', true)
    expect(step2.success).toBe(true)
    expect(step2.prompt).toContain('🤖 Enter main model name')

    // Step 3: Main Model
    const step3 = await advanceStep(userId, storageContextId, 'gpt-4', true)
    expect(step3.success).toBe(true)
    expect(step3.prompt).toContain('⚡ Enter small model name')

    // Step 4: Small Model (use 'same' to copy main model)
    const step4 = await advanceStep(userId, storageContextId, 'same', true)
    expect(step4.success).toBe(true)
    expect(step4.prompt).toContain('📊 Enter embedding model')

    // Step 5: Embedding Model (optional - skip it)
    const step5 = await advanceStep(userId, storageContextId, 'skip', true)
    expect(step5.success).toBe(true)
    expect(step5.skipped).toBe(true)
    expect(step5.prompt).toContain('🔑 Enter your Kaneo API key')

    // Step 6: Kaneo API Key
    const step6 = await advanceStep(userId, storageContextId, 'kaneo-token', true)
    expect(step6.success).toBe(true)
    expect(step6.prompt).toContain('🌍 Enter your timezone')

    // Step 7: Timezone
    const step7 = await advanceStep(userId, storageContextId, 'UTC', true)
    expect(step7.success).toBe(true)
    expect(step7.complete).toBe(true)
    expect(step7.prompt).toContain('Configuration Summary')
    expect(step7.prompt).toContain('LLM API Key:')
    expect(step7.prompt).toContain('Kaneo API Key:')

    // Confirm
    const saveResult = await validateAndSaveWizardConfig(userId, storageContextId)
    expect(saveResult.success).toBe(true)
    expect(saveResult.message).toContain('Configuration saved successfully')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)

    // Verify config was saved under storageContextId
    expect(getConfig(storageContextId, 'llm_apikey')).toBe('sk-api-key')
    expect(getConfig(storageContextId, 'main_model')).toBe('gpt-4')
    expect(getConfig(storageContextId, 'small_model')).toBe('gpt-4')
    expect(getConfig(storageContextId, 'kaneo_apikey')).toBe('kaneo-token')
    expect(getConfig(storageContextId, 'timezone')).toBe('UTC')

    // Verify skipped value was NOT saved
    expect(getConfig(storageContextId, 'embedding_model')).toBeNull()
  })

  test('should handle processWizardMessage', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Send API key through processWizardMessage
    const result = await processWizardMessage(userId, storageContextId, 'sk-test-key')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('🌐 Enter base URL')
    expect(result.requiresInput).toBe(true)

    // Verify session advanced
    const nextResult = await processWizardMessage(userId, storageContextId, 'https://api.openai.com/v1')
    expect(nextResult.handled).toBe(true)
    expect(nextResult.response).toContain('🤖 Enter main model name')
  })

  test('should cancel wizard', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(true)

    // Cancel via processWizardMessage
    const result = await processWizardMessage(userId, storageContextId, 'cancel')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('cancelled')
    expect(result.response).toContain('not saved')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)

    // No config should be saved (wizard was cancelled before save)
    expect(getConfig(userId, 'llm_apikey')).toBeNull()
  })

  test('should handle invalid input', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Try empty API key (don't skip validation)
    const result = await advanceStep(userId, storageContextId, '')
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('API key cannot be empty')
    expect(result.prompt).toContain('Please try again')

    // Verify still on same step
    const session = await processWizardMessage(userId, storageContextId, 'valid-key')
    expect(session.handled).toBe(true)
    expect(session.response).toContain('🌐 Enter base URL')
  })

  test('should handle cancel command at any step', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Complete first step
    await advanceStep(userId, storageContextId, 'sk-test-key', true)
    await advanceStep(userId, storageContextId, 'default', true)

    // Cancel at step 3
    const result = await processWizardMessage(userId, storageContextId, 'cancel')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('cancelled')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)
  })

  test('should confirm with yes command', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Complete all steps
    await advanceStep(userId, storageContextId, 'sk-test-key', true)
    await advanceStep(userId, storageContextId, 'default', true)
    await advanceStep(userId, storageContextId, 'gpt-4', true)
    await advanceStep(userId, storageContextId, 'same', true)
    await advanceStep(userId, storageContextId, 'skip', true)
    await advanceStep(userId, storageContextId, 'kaneo-key', true)
    await advanceStep(userId, storageContextId, 'workspace-123', true)
    await advanceStep(userId, storageContextId, 'UTC', true)

    // Confirm with 'yes'
    const result = await processWizardMessage(userId, storageContextId, 'yes')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('Configuration saved successfully')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)
  })

  test('should confirm with confirm command', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Complete all steps
    await advanceStep(userId, storageContextId, 'sk-test-key', true)
    await advanceStep(userId, storageContextId, 'default', true)
    await advanceStep(userId, storageContextId, 'gpt-4', true)
    await advanceStep(userId, storageContextId, 'same', true)
    await advanceStep(userId, storageContextId, 'skip', true)
    await advanceStep(userId, storageContextId, 'kaneo-key', true)
    await advanceStep(userId, storageContextId, 'UTC', true)

    // Confirm with 'confirm'
    const result = await processWizardMessage(userId, storageContextId, 'confirm')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('Configuration saved successfully')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)
  })

  test('should handle YouTrack provider flow', async () => {
    // Start wizard with YouTrack
    const startResult = await createWizard(userId, storageContextId, 'youtrack')
    expect(startResult.success).toBe(true)

    // Complete all steps
    // Step 1: LLM API Key
    await advanceStep(userId, storageContextId, 'sk-api-key', true)
    // Step 2: Base URL
    await advanceStep(userId, storageContextId, 'default', true)
    // Step 3: Main Model
    await advanceStep(userId, storageContextId, 'gpt-4', true)
    // Step 4: Small Model
    await advanceStep(userId, storageContextId, 'same', true)
    // Step 5: Embedding (skip)
    await advanceStep(userId, storageContextId, 'skip', true)

    // Step 6 should be YouTrack token
    const step6 = await advanceStep(userId, storageContextId, 'youtrack-token', true)
    expect(step6.success).toBe(true)
    expect(step6.prompt).toContain('timezone')

    // Step 7: Timezone
    await advanceStep(userId, storageContextId, 'America/New_York', true)

    // Save
    const saveResult = await validateAndSaveWizardConfig(userId, storageContextId)
    expect(saveResult.success).toBe(true)

    // Verify YouTrack token was saved under storageContextId
    expect(getConfig(storageContextId, 'youtrack_token')).toBe('youtrack-token')
  })

  test('should skip only optional steps', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Try to skip required step 1 (API key)
    const result = await advanceStep(userId, storageContextId, 'skip', true)
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('required and cannot be skipped')

    // Complete required steps
    await advanceStep(userId, storageContextId, 'sk-api-key', true)
    await advanceStep(userId, storageContextId, 'default', true)
    await advanceStep(userId, storageContextId, 'gpt-4', true)
    await advanceStep(userId, storageContextId, 'same', true)

    // Now we can skip step 5 (embedding model - optional)
    const skipResult = await advanceStep(userId, storageContextId, 'skip', true)
    expect(skipResult.success).toBe(true)
    expect(skipResult.skipped).toBe(true)
  })

  test('should reject default as invalid base URL', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Step 1
    await advanceStep(userId, storageContextId, 'sk-api-key', true)

    // Step 2 with 'default' value - should be rejected
    const result = await advanceStep(userId, storageContextId, 'default')
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('valid URL')
  })

  test('should handle invalid URL validation', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Step 1
    await advanceStep(userId, storageContextId, 'sk-api-key', true)

    // Step 2 with invalid URL
    const result = await advanceStep(userId, storageContextId, 'not-a-url')
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('valid URL')
  })

  test('should handle invalid timezone validation', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Complete steps up to timezone
    await advanceStep(userId, storageContextId, 'sk-api-key', true)
    await advanceStep(userId, storageContextId, 'default', true)
    await advanceStep(userId, storageContextId, 'gpt-4', true)
    await advanceStep(userId, storageContextId, 'same', true)
    await advanceStep(userId, storageContextId, 'skip', true)
    await advanceStep(userId, storageContextId, 'kaneo-key', true)

    // Invalid timezone
    const result = await advanceStep(userId, storageContextId, 'invalid-timezone')
    expect(result.success).toBe(false)
    expect(result.prompt).toContain('Invalid timezone')
  })

  test('should handle processWizardMessage with no active wizard', async () => {
    const result = await processWizardMessage(userId, storageContextId, 'hello')
    expect(result.handled).toBe(false)
    expect(result.response).toBeUndefined()
  })

  test('should handle case insensitive cancel', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    // Test different cases
    const result1 = await processWizardMessage(userId, storageContextId, 'CANCEL')
    expect(result1.handled).toBe(true)
    expect(result1.response).toContain('cancelled')

    // Recreate wizard
    await createWizard(userId, storageContextId, 'kaneo')
    const result2 = await processWizardMessage(userId, storageContextId, 'Cancel')
    expect(result2.handled).toBe(true)

    // Recreate wizard
    await createWizard(userId, storageContextId, 'kaneo')
    const result3 = await processWizardMessage(userId, storageContextId, '  cancel  ')
    expect(result3.handled).toBe(true)
  })

  test('should isolate sessions between users', async () => {
    const userId1 = 'user-1'
    const userId2 = 'user-2'

    await createWizard(userId1, storageContextId, 'kaneo')
    await createWizard(userId2, storageContextId, 'kaneo')

    // Both should have active wizards
    expect(await hasActiveWizard(userId1, storageContextId)).toBe(true)
    expect(await hasActiveWizard(userId2, storageContextId)).toBe(true)

    // Cancel one
    await processWizardMessage(userId1, storageContextId, 'cancel')

    // Only user1 should be cancelled
    expect(await hasActiveWizard(userId1, storageContextId)).toBe(false)
    expect(await hasActiveWizard(userId2, storageContextId)).toBe(true)

    // Clean up
    await deleteWizardSession(userId2, storageContextId)
  })

  test('should isolate sessions between contexts', async () => {
    const contextId1 = 'ctx-1'
    const contextId2 = 'ctx-2'

    await createWizard(userId, contextId1, 'kaneo')
    await createWizard(userId, contextId2, 'kaneo')

    // Both should have active wizards
    expect(await hasActiveWizard(userId, contextId1)).toBe(true)
    expect(await hasActiveWizard(userId, contextId2)).toBe(true)

    // Cancel one
    await processWizardMessage(userId, contextId1, 'cancel')

    // Only context1 should be cancelled
    expect(await hasActiveWizard(userId, contextId1)).toBe(false)
    expect(await hasActiveWizard(userId, contextId2)).toBe(true)

    // Clean up
    await deleteWizardSession(userId, contextId2)
  })
})
