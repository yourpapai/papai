// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard integration tests - Phase 1 two-step flow.
 * LLM credentials live in `system_config` (admin-owned) and no longer
 * appear in the user-facing wizard.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getConfig, getConfigValue } from '../../src/config.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const { createWizard, advanceStep, processWizardMessage } = await import('../../src/wizard/engine.js')
const { validateAndSaveWizardConfig } = await import('../../src/wizard/save.js')
const { hasActiveWizard, deleteWizardSession } = await import('../../src/wizard/state.js')

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'
const YOUTRACK_TOKEN_KEY = 'plugin:task-provider-youtrack:provider:token'

const registerKaneoContributed = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'kaneo' }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' }],
    contextConfigSchema: [
      // label matches BUILTIN_PROMPTS fallback: '🔑 Enter your Kaneo API key:'
      // workspaceId omitted here: resolved via getKaneoWorkspace special-case in resolver, not wizard
      {
        key: 'credential',
        label: 'Kaneo API key',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'kaneo_apikey',
      },
    ],
    traits: new Set(),
  })
}

// Contributed kaneo stores credential at plugin-namespaced key, not 'kaneo_apikey'
const KANEO_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'

describe('Wizard Integration (Phase 1)', () => {
  const userId = 'test-user'
  const storageContextId = 'test-context'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await deleteWizardSession(userId, storageContextId)
    registerKaneoContributed()
    registerContributedTaskProviderType('youtrack', {
      pluginId: YOUTRACK_PLUGIN_ID,
      factory: () => createMockProvider({ name: 'youtrack' }),
      capabilities: new Set(),
      displayName: 'YouTrack',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [
        {
          key: 'token',
          label: 'YouTrack Permanent Token',
          required: true,
          sensitive: true,
          scope: 'context',
          storageKey: 'youtrack_token',
        },
      ],
      traits: new Set(),
    })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
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
    // contributed kaneo label is 'Kaneo API key' (from descriptor)
    expect(step2.prompt).toContain('Kaneo API key')
    expect(step2.prompt).not.toContain('LLM API Key')

    const saveResult = await validateAndSaveWizardConfig(userId, storageContextId)
    expect(saveResult.success).toBe(true)
    expect(saveResult.message).toContain('Configuration saved successfully')
    expect(await hasActiveWizard(userId, storageContextId)).toBe(false)

    // kaneo is now plugin-contributed; credential stored under plugin-namespaced key
    expect(getConfigValue(storageContextId, KANEO_CREDENTIAL_KEY)).toBe('kaneo-token')
    expect(getConfig(storageContextId, 'timezone')).toBe('UTC')
  })

  test('completes the youtrack two-step flow', async () => {
    // youtrack is now plugin-contributed; prompt uses label fallback (no BUILTIN_PROMPTS match)
    const start = await createWizard(userId, storageContextId, 'youtrack')
    expect(start.success).toBe(true)
    // contributed youtrack uses '🔑 Enter your YouTrack Permanent Token:' (label fallback)
    expect(start.prompt).toContain('🔑 Enter your YouTrack Permanent Token')

    await advanceStep(userId, storageContextId, 'perm:token', true)
    const step2 = await advanceStep(userId, storageContextId, 'America/New_York', true)
    expect(step2.complete).toBe(true)

    const saveResult = await validateAndSaveWizardConfig(userId, storageContextId)
    expect(saveResult.success).toBe(true)
    // contributed youtrack stores token under plugin-namespaced key
    expect(getConfigValue(storageContextId, YOUTRACK_TOKEN_KEY)).toBe('perm:token')
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

    // After cancel, no credential saved at the plugin-namespaced key either
    expect(getConfigValue(userId, KANEO_CREDENTIAL_KEY)).toBeNull()
  })

  test('rejects empty kaneo_apikey and stays on the same step', async () => {
    await createWizard(userId, storageContextId, 'kaneo')

    const result = await advanceStep(userId, storageContextId, '')
    expect(result.success).toBe(false)
    // contributed kaneo uses generic required-field validator: '${field.label} cannot be empty'
    expect(result.prompt).toContain('Kaneo API key cannot be empty')
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
