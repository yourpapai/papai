// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getWizardSteps, validateStep, getStepByIndex, formatSummary } from '../../src/wizard/steps.js'
import type { WizardStep } from '../../src/wizard/types.js'

describe('getWizardSteps', () => {
  test('returns correct steps for kaneo provider', () => {
    const steps = getWizardSteps('kaneo')

    expect(steps).toHaveLength(7)
    expect(steps[0]?.key).toBe('llm_apikey')
    expect(steps[1]?.key).toBe('llm_baseurl')
    expect(steps[2]?.key).toBe('main_model')
    expect(steps[3]?.key).toBe('small_model')
    expect(steps[4]?.key).toBe('embedding_model')
    expect(steps[5]?.key).toBe('kaneo_apikey')
    expect(steps[6]?.key).toBe('timezone')
  })

  test('returns correct steps for youtrack provider', () => {
    const steps = getWizardSteps('youtrack')

    expect(steps).toHaveLength(7)
    expect(steps[0]?.key).toBe('llm_apikey')
    expect(steps[1]?.key).toBe('llm_baseurl')
    expect(steps[2]?.key).toBe('main_model')
    expect(steps[3]?.key).toBe('small_model')
    expect(steps[4]?.key).toBe('embedding_model')
    expect(steps[5]?.key).toBe('youtrack_token')
    expect(steps[6]?.key).toBe('timezone')
  })

  test('embedding_model step is optional', () => {
    const steps = getWizardSteps('kaneo')
    const embeddingStep = steps.find((s: WizardStep) => s.key === 'embedding_model')

    expect(embeddingStep?.isOptional).toBe(true)
  })

  test('llm_apikey step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'llm_apikey')

    expect(step?.prompt).toBe('🔑 Enter your LLM API key:')
  })

  test('llm_baseurl step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'llm_baseurl')

    expect(step?.prompt).toBe('🌐 Enter base URL (e.g., https://api.openai.com/v1):')
  })

  test('main_model step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'main_model')

    expect(step?.prompt).toBe('🤖 Enter main model name (e.g., gpt-5.4, claude-sonnet-4-6):')
  })

  test('small_model step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'small_model')

    expect(step?.prompt).toBe("⚡ Enter small model name (or 'same' to use main model):")
  })

  test('embedding_model step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'embedding_model')

    expect(step?.prompt).toBe('📊 Enter embedding model for semantic search (skip to disable):')
  })

  test('kaneo_apikey step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'kaneo_apikey')

    expect(step?.prompt).toBe('🔑 Enter your Kaneo API key:')
  })

  test('youtrack_token step has correct prompt', () => {
    const steps = getWizardSteps('youtrack')
    const step = steps.find((s: WizardStep) => s.key === 'youtrack_token')

    expect(step?.prompt).toBe('🔑 Enter your YouTrack token:')
  })

  test('timezone step has correct prompt', () => {
    const steps = getWizardSteps('kaneo')
    const step = steps.find((s: WizardStep) => s.key === 'timezone')

    expect(step?.prompt).toBe('🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5):')
  })

  test('all steps have validation functions', () => {
    const steps = getWizardSteps('kaneo')

    for (const step of steps) {
      expect(typeof step.validate).toBe('function')
    }
  })
})

describe('validateStep', () => {
  test('validates llm_apikey - accepts non-empty string', async () => {
    const result = await validateStep('llm_apikey', 'sk-test123')
    expect(result).toBeNull()
  })

  test('validates llm_apikey - rejects empty string', async () => {
    const result = await validateStep('llm_apikey', '')
    expect(result).toBe('API key cannot be empty')
  })

  test('validates llm_apikey - rejects whitespace-only string', async () => {
    const result = await validateStep('llm_apikey', '   ')
    expect(result).toBe('API key cannot be empty')
  })

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

  test('validates llm_baseurl - accepts valid URL', async () => {
    const result = await validateStep('llm_baseurl', 'https://api.openai.com')
    expect(result).toBeNull()
  })

  test('validates llm_baseurl - accepts http URL', async () => {
    const result = await validateStep('llm_baseurl', 'http://localhost:8080')
    expect(result).toBeNull()
  })

  test('validates llm_baseurl - rejects "default" as invalid', async () => {
    const result = await validateStep('llm_baseurl', 'default')
    expect(result).toBe('Please enter a valid URL (http/https)')
  })

  test('validates llm_baseurl - rejects invalid URL', async () => {
    const result = await validateStep('llm_baseurl', 'not-a-url')
    expect(result).toBe('Please enter a valid URL (http/https)')
  })

  test('validates main_model - accepts non-empty string', async () => {
    const result = await validateStep('main_model', 'gpt-4')
    expect(result).toBeNull()
  })

  test('validates main_model - rejects empty string', async () => {
    const result = await validateStep('main_model', '')
    expect(result).toBe('Model name cannot be empty')
  })

  test('validates small_model - accepts non-empty string', async () => {
    const result = await validateStep('small_model', 'same')
    expect(result).toBeNull()
  })

  test('validates small_model - rejects empty string', async () => {
    const result = await validateStep('small_model', '')
    expect(result).toBe('Model name cannot be empty')
  })

  test('validates embedding_model - accepts non-empty string', async () => {
    const result = await validateStep('embedding_model', 'text-embedding-3-small')
    expect(result).toBeNull()
  })

  test('validates embedding_model - accepts "skip" keyword', async () => {
    const result = await validateStep('embedding_model', 'skip')
    expect(result).toBeNull()
  })

  test('validates embedding_model - rejects empty string', async () => {
    const result = await validateStep('embedding_model', '')
    expect(result).toBe('Model name cannot be empty')
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
      'Invalid timezone. Please enter a valid IANA timezone (e.g., America/New_York, UTC) or UTC offset (e.g., UTC+5)',
    )
  })

  test('validates unknown step - returns null', async () => {
    const result = await validateStep('unknown_step', 'value')
    expect(result).toBeNull()
  })
})

describe('getStepByIndex', () => {
  test('returns correct step for valid index', () => {
    const step = getStepByIndex('kaneo', 0)

    expect(step).toBeDefined()
    expect(step?.key).toBe('llm_apikey')
  })

  test('returns correct step for youtrack provider', () => {
    const step = getStepByIndex('youtrack', 5)

    expect(step?.key).toBe('youtrack_token')
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
      llm_apikey: 'sk-abc123def456',
      llm_baseurl: 'https://api.openai.com',
      main_model: 'gpt-4',
      small_model: 'same',
      embedding_model: 'skip',
      kaneo_apikey: 'my-secret-kaneo-key',
      timezone: 'America/New_York',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('Configuration Summary')
    expect(summary).toContain('LLM API Key: ****f456')
    expect(summary).toContain('Base URL: https://api.openai.com')
    expect(summary).toContain('Main Model: gpt-4')
    expect(summary).toContain('Small Model: same')
    expect(summary).toContain('Embedding Model: skip')
    expect(summary).toContain('Kaneo API Key: ****-key')
    expect(summary).toContain('Timezone: America/New_York')
  })

  test('formats summary for youtrack provider', () => {
    const data = {
      llm_apikey: 'sk-secretkey',
      llm_baseurl: 'default',
      main_model: 'claude-3-opus',
      small_model: 'claude-3-sonnet',
      embedding_model: 'text-embedding-3-small',
      youtrack_token: 'perm:yt-token',
      timezone: 'UTC',
    }

    const summary = formatSummary(data, 'youtrack')

    expect(summary).toContain('Configuration Summary')
    expect(summary).toContain('LLM API Key: ****tkey')
    expect(summary).toContain('Base URL: default')
    expect(summary).toContain('Main Model: claude-3-opus')
    expect(summary).toContain('Small Model: claude-3-sonnet')
    expect(summary).toContain('Embedding Model: text-embedding-3-small')
    expect(summary).toContain('YouTrack Token: ****oken')
    expect(summary).toContain('Timezone: UTC')
  })

  test('masks API key correctly - long key', () => {
    const data = {
      llm_apikey: 'sk-abcdefghijklmnopqrstuvwxyz',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('****wxyz')
  })

  test('masks API key correctly - short key', () => {
    const data = {
      llm_apikey: 'sk-abc',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('****-abc')
  })

  test('handles missing optional values', () => {
    const data = {
      llm_apikey: 'sk-test',
      llm_baseurl: 'default',
      main_model: 'gpt-4',
      small_model: 'same',
      kaneo_apikey: 'key123',
      timezone: 'UTC',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('LLM API Key: ****test')
    expect(summary).not.toContain('Embedding Model')
  })

  test('shows "Not set" for missing required values', () => {
    const data = {
      llm_apikey: 'sk-test',
    }

    const summary = formatSummary(data, 'kaneo')

    expect(summary).toContain('Base URL: Not set')
    expect(summary).toContain('Main Model: Not set')
    expect(summary).toContain('Kaneo API Key: Not set')
    expect(summary).toContain('Timezone: Not set')
  })
})
