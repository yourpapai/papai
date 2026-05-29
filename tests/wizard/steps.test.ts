// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { getWizardSteps, getStepByIndex, formatSummary } from '../../src/wizard/steps.js'
import { createMockProvider } from '../tools/mock-provider.js'

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const KANEO_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'
const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'
const YOUTRACK_TOKEN_KEY = 'plugin:task-provider-youtrack:provider:token'

const registerYouTrackContributed = (): void => {
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
}

const registerKaneoContributed = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'kaneo' }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' }],
    contextConfigSchema: [
      // workspaceId omitted: handled by getKaneoWorkspace, not wizard
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

describe('getWizardSteps', () => {
  beforeEach(() => {
    registerKaneoContributed()
    registerYouTrackContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
    unregisterContributedTaskProviderType('plugin-tracker')
  })

  test('returns the two-step provider+timezone wizard for kaneo (contributed)', () => {
    const steps = getWizardSteps('kaneo')

    expect(steps).toHaveLength(2)
    // contributed kaneo uses plugin-namespaced storage key
    expect(steps[0]?.key).toBe(KANEO_CREDENTIAL_KEY)
    expect(steps[1]?.key).toBe('timezone')
  })

  test('returns the two-step provider+timezone wizard for youtrack (contributed)', () => {
    const steps = getWizardSteps('youtrack')

    expect(steps).toHaveLength(2)
    // contributed youtrack uses plugin-namespaced storage key
    expect(steps[0]?.key).toBe(YOUTRACK_TOKEN_KEY)
    expect(steps[1]?.key).toBe('timezone')
  })

  test('no LLM steps remain (credentials live in system_config)', () => {
    // kaneo is now plugin-contributed; its credential step uses plugin-namespaced key
    const kaneoKeys: readonly string[] = getWizardSteps('kaneo').map((s) => s.key)
    const youtrackKeys: readonly string[] = getWizardSteps('youtrack').map((s) => s.key)
    expect(kaneoKeys).not.toContain('llm_apikey')
    expect(kaneoKeys).not.toContain('llm_baseurl')
    expect(kaneoKeys).not.toContain('main_model')
    expect(kaneoKeys).not.toContain('small_model')
    expect(kaneoKeys).not.toContain('embedding_model')
    expect(youtrackKeys).not.toContain('llm_apikey')
    expect(youtrackKeys).not.toContain('llm_baseurl')
    expect(youtrackKeys).not.toContain('main_model')
    expect(youtrackKeys).not.toContain('small_model')
    expect(youtrackKeys).not.toContain('embedding_model')
  })

  test('kaneo credential step has correct prompt (contributed, uses label fallback)', () => {
    const steps = getWizardSteps('kaneo')
    // contributed kaneo uses the label fallback: '🔑 Enter your ${field.label}:'
    expect(steps[0]?.prompt).toBe('🔑 Enter your Kaneo API key:')
  })

  test('youtrack token step uses label fallback prompt (contributed, no BUILTIN_PROMPTS match)', () => {
    // contributed youtrack token storageKey is plugin-namespaced; BUILTIN_PROMPTS has no entry for it
    // so the prompt falls back to '🔑 Enter your ${field.label}:'
    const steps = getWizardSteps('youtrack')
    expect(steps[0]?.prompt).toBe('🔑 Enter your YouTrack Permanent Token:')
  })

  test('timezone step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    expect(steps[1]?.prompt).toBe(
      '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5). UTC offsets are accepted and saved as a standard timezone:',
    )
  })

  test('all steps have validation functions', () => {
    const steps = getWizardSteps('kaneo')
    for (const step of steps) {
      expect(typeof step.validate).toBe('function')
    }
  })

  test('returns plugin provider context credential steps', () => {
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [{ key: 'token', label: 'Plugin Token', required: true, sensitive: true, scope: 'context' }],
    })

    const steps = getWizardSteps('plugin-tracker')

    expect(steps.map((step) => step.key)).toEqual(['plugin:plugin-tracker:provider:token', 'timezone'])
    expect(steps[0]?.field.label).toBe('Plugin Token')
  })
})

describe('step validation', () => {
  beforeEach(() => {
    registerKaneoContributed()
    registerYouTrackContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
  })

  test('validates kaneo credential - accepts non-empty string (contributed)', async () => {
    const result = await getWizardSteps('kaneo')[0]!.validate('my-api-key')
    expect(result).toBeNull()
  })

  test('validates kaneo credential - rejects empty string (contributed, generic validator)', async () => {
    const result = await getWizardSteps('kaneo')[0]!.validate('')
    // contributed kaneo uses generic required-field validator: '${field.label} cannot be empty'
    expect(result).toBe('Kaneo API key cannot be empty')
  })

  test('validates youtrack token step - accepts non-empty string (contributed)', async () => {
    // contributed youtrack token uses generic required-field validator
    const result = await getWizardSteps('youtrack')[0]!.validate('perm:my-token')
    expect(result).toBeNull()
  })

  test('validates youtrack token step - rejects empty string (contributed, generic validator)', async () => {
    // contributed youtrack uses generic required-field validator: '${field.label} cannot be empty'
    const result = await getWizardSteps('youtrack')[0]!.validate('')
    expect(result).toBe('YouTrack Permanent Token cannot be empty')
  })

  test('validates timezone - accepts valid IANA timezone', async () => {
    // Use youtrack (contributed) for stable timezone step index tests (step index 1)
    const result = await getWizardSteps('youtrack')[1]!.validate('America/New_York')
    expect(result).toBeNull()
  })

  test('validates timezone - accepts UTC', async () => {
    const result = await getWizardSteps('youtrack')[1]!.validate('UTC')
    expect(result).toBeNull()
  })

  test('validates timezone - accepts UTC offset', async () => {
    const result = await getWizardSteps('youtrack')[1]!.validate('UTC+5')
    expect(result).toBeNull()
  })

  test('validates timezone - rejects invalid timezone', async () => {
    const result = await getWizardSteps('youtrack')[1]!.validate('Invalid/Timezone')
    expect(result).toBe(
      'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.',
    )
  })
})

describe('getStepByIndex', () => {
  beforeEach(() => {
    registerKaneoContributed()
    registerYouTrackContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
  })

  test('returns the first step for index 0 (kaneo contributed)', () => {
    const step = getStepByIndex('kaneo', 0)
    // contributed kaneo uses plugin-namespaced storage key
    expect(step?.key).toBe(KANEO_CREDENTIAL_KEY)
  })

  test('returns the second step for index 1 (youtrack contributed)', () => {
    const step = getStepByIndex('youtrack', 1)
    expect(step?.key).toBe('timezone')
  })

  test('returns undefined for out-of-range index', () => {
    const step = getStepByIndex('youtrack', 100)
    expect(step).toBeUndefined()
  })

  test('returns undefined for negative index', () => {
    const step = getStepByIndex('youtrack', -1)
    expect(step).toBeUndefined()
  })
})

describe('formatSummary', () => {
  beforeEach(() => {
    registerKaneoContributed()
    registerYouTrackContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
  })

  test('formats summary for kaneo provider (contributed)', () => {
    // contributed kaneo stores credential under plugin-namespaced key
    const data = {
      [KANEO_CREDENTIAL_KEY]: 'my-secret-kaneo-key',
      timezone: 'America/New_York',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('Configuration Summary')
    // label is 'Kaneo API key' (from descriptor)
    expect(summary).toContain('Kaneo API key: ****-key')
    expect(summary).toContain('Timezone: America/New_York')
    expect(summary).not.toContain('LLM API Key')
    expect(summary).not.toContain('Base URL')
  })

  test('formats summary for youtrack provider (contributed)', () => {
    // contributed youtrack token is stored under plugin-namespaced key
    const data = {
      [YOUTRACK_TOKEN_KEY]: 'perm:yt-token',
      timezone: 'UTC',
    }

    const summary = formatSummary(data, 'youtrack')

    expect(summary).toContain('Configuration Summary')
    // label is 'YouTrack Permanent Token' (from descriptor), displayLabelForKey falls back to label
    expect(summary).toContain('YouTrack Permanent Token: ****oken')
    expect(summary).toContain('Timezone: UTC')
    expect(summary).not.toContain('LLM API Key')
  })

  test('shows "Not set" for missing required values', () => {
    const summary = formatSummary({}, 'kaneo')
    // label is 'Kaneo API key' (from contributed descriptor)
    expect(summary).toContain('Kaneo API key: Not set')
    expect(summary).toContain('Timezone: Not set')
  })
})
