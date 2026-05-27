// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { getWizardSteps, validateStep, getStepByIndex, formatSummary } from '../../src/wizard/steps.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('getWizardSteps', () => {
  afterEach(() => {
    unregisterContributedTaskProviderType('plugin-tracker')
  })

  test('returns the two-step provider+timezone wizard for kaneo', () => {
    const steps = getWizardSteps('kaneo')

    expect(steps).toHaveLength(2)
    expect(steps[0]?.key).toBe('kaneo_apikey')
    expect(steps[1]?.key).toBe('timezone')
  })

  test('returns the two-step provider+timezone wizard for youtrack', () => {
    const steps = getWizardSteps('youtrack')

    expect(steps).toHaveLength(2)
    expect(steps[0]?.key).toBe('youtrack_token')
    expect(steps[1]?.key).toBe('timezone')
  })

  test('no LLM steps remain (credentials live in system_config)', () => {
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

  test('kaneo_apikey step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    expect(steps[0]?.prompt).toBe('🔑 Enter your Kaneo API key:')
  })

  test('youtrack_token step has correct prompt', () => {
    const steps = getWizardSteps('youtrack')
    expect(steps[0]?.prompt).toBe('🔑 Enter your YouTrack token:')
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
      configSchema: [{ key: 'token', label: 'Plugin Token', required: true, sensitive: true, scope: 'context' }],
    })

    const steps = getWizardSteps('plugin-tracker')

    expect(steps.map((step) => step.key)).toEqual(['plugin:plugin-tracker:provider:token', 'timezone'])
    expect(steps[0]?.field.label).toBe('Plugin Token')
  })
})

describe('validateStep', () => {
  test('validates kaneo_apikey - accepts non-empty string', async () => {
    const result = await validateStep('kaneo_apikey', 'my-api-key')
    expect(result).toBeNull()
  })

  test('validates kaneo_apikey - rejects empty string', async () => {
    const result = await validateStep('kaneo_apikey', '')
    expect(result).toBe('API key cannot be empty')
  })

  test('validates youtrack_token - accepts non-empty string', async () => {
    const result = await validateStep('youtrack_token', 'perm:my-token')
    expect(result).toBeNull()
  })

  test('validates youtrack_token - rejects empty string', async () => {
    const result = await validateStep('youtrack_token', '')
    expect(result).toBe('Token cannot be empty')
  })

  test('validates timezone - accepts valid IANA timezone', async () => {
    const result = await validateStep('timezone', 'America/New_York')
    expect(result).toBeNull()
  })

  test('validates timezone - accepts UTC', async () => {
    const result = await validateStep('timezone', 'UTC')
    expect(result).toBeNull()
  })

  test('validates timezone - accepts UTC offset', async () => {
    const result = await validateStep('timezone', 'UTC+5')
    expect(result).toBeNull()
  })

  test('validates timezone - rejects invalid timezone', async () => {
    const result = await validateStep('timezone', 'Invalid/Timezone')
    expect(result).toBe(
      'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.',
    )
  })

  test('validates unknown step - returns null', async () => {
    const result = await validateStep('unknown_step', 'value')
    expect(result).toBeNull()
  })
})

describe('getStepByIndex', () => {
  test('returns the first step for index 0 (kaneo)', () => {
    const step = getStepByIndex('kaneo', 0)
    expect(step?.key).toBe('kaneo_apikey')
  })

  test('returns the second step for index 1 (youtrack)', () => {
    const step = getStepByIndex('youtrack', 1)
    expect(step?.key).toBe('timezone')
  })

  test('returns undefined for out-of-range index', () => {
    const step = getStepByIndex('kaneo', 100)
    expect(step).toBeUndefined()
  })

  test('returns undefined for negative index', () => {
    const step = getStepByIndex('kaneo', -1)
    expect(step).toBeUndefined()
  })
})

describe('formatSummary', () => {
  test('formats summary for kaneo provider', () => {
    const data = {
      kaneo_apikey: 'my-secret-kaneo-key',
      timezone: 'America/New_York',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('Configuration Summary')
    expect(summary).toContain('Kaneo API Key: ****-key')
    expect(summary).toContain('Timezone: America/New_York')
    expect(summary).not.toContain('LLM API Key')
    expect(summary).not.toContain('Base URL')
  })

  test('formats summary for youtrack provider', () => {
    const data = {
      youtrack_token: 'perm:yt-token',
      timezone: 'UTC',
    }

    const summary = formatSummary(data, 'youtrack')

    expect(summary).toContain('Configuration Summary')
    expect(summary).toContain('YouTrack Token: ****oken')
    expect(summary).toContain('Timezone: UTC')
    expect(summary).not.toContain('LLM API Key')
  })

  test('shows "Not set" for missing required values', () => {
    const summary = formatSummary({}, 'kaneo')
    expect(summary).toContain('Kaneo API Key: Not set')
    expect(summary).toContain('Timezone: Not set')
  })
})
