/**
 * Type tests for wizard types
 */

import { describe, expect, test } from 'bun:test'

import type { ConfigKey } from '../../src/types/config.js'
import type { WizardSession, WizardData, WizardStep, WizardProcessResult } from '../../src/wizard/types.js'

function validateApiKey(value: string): Promise<string | null> {
  if (value.startsWith('sk-')) return Promise.resolve(null)
  return Promise.resolve('Invalid API key format')
}

describe('Wizard Types', () => {
  test('WizardSession interface structure', () => {
    const session: WizardSession = {
      userId: 'user123',
      storageContextId: 'ctx-456',
      startedAt: new Date(),
      currentStep: 1,
      totalSteps: 3,
      data: {
        llm_apikey: 'sk-test',
        timezone: 'UTC',
      },
      skippedSteps: [2],
      taskProvider: 'kaneo',
    }

    expect(session.userId).toBe('user123')
    expect(session.currentStep).toBe(1)
    expect(session.data.llm_apikey).toBe('sk-test')
    expect(session.skippedSteps).toEqual([2])
  })

  test('WizardData type compatibility with ConfigKey', () => {
    const validData: WizardData = {
      llm_apikey: 'sk-abc',
      llm_baseurl: 'https://api.example.com',
      main_model: 'gpt-4',
      small_model: 'gpt-3.5',
      embedding_model: 'text-embedding-3',
      timezone: 'America/New_York',
    }

    expect(Object.keys(validData).length).toBe(6)
  })

  test('WizardStep interface structure', async () => {
    const step: WizardStep = {
      id: 'step-1',
      key: 'llm_apikey',
      prompt: 'Please enter your LLM API key:',
      validate: validateApiKey,
      isOptional: false,
    }

    expect(step.id).toBe('step-1')
    expect(step.key).toBe('llm_apikey')
    expect(step.isOptional).toBe(false)

    const validationResult = await step.validate('invalid')
    expect(validationResult).toBe('Invalid API key format')

    const validResult = await step.validate('sk-valid')
    expect(validResult).toBeNull()
  })

  test('WizardStep without optional fields', () => {
    const step: WizardStep = {
      id: 'step-2',
      key: 'timezone',
      prompt: 'Enter timezone:',
      validate: () => Promise.resolve(null),
    }

    expect(step.isOptional).toBeUndefined()
  })

  test('WizardProcessResult interface structure', () => {
    const result1: WizardProcessResult = {
      handled: false,
    }

    const result2: WizardProcessResult = {
      handled: true,
      response: 'Step completed successfully',
      requiresInput: true,
      isSensitiveKey: true,
    }

    expect(result1.handled).toBe(false)
    expect(result1.response).toBeUndefined()
    expect(result2.response).toBe('Step completed successfully')
    expect(result2.requiresInput).toBe(true)
    expect(result2.isSensitiveKey).toBe(true)
  })

  test('WizardData restricts keys to ConfigKey', () => {
    // This test verifies at compile time that WizardData uses ConfigKey
    const configKey: ConfigKey = 'llm_apikey'
    const data: WizardData = {
      [configKey]: 'test-value',
    }

    expect(data[configKey]).toBe('test-value')
  })
})
