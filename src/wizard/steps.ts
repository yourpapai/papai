// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { maskValue } from '../config.js'
import type { ConfigKey } from '../types/config.js'
import { normalizeTimezone } from '../utils/timezone.js'
import type { WizardStep } from './types.js'

type TaskProvider = 'kaneo' | 'youtrack'

const PROVIDER_SPECIFIC_STEP: Record<TaskProvider, { key: 'kaneo_apikey' | 'youtrack_token'; prompt: string }> = {
  kaneo: {
    key: 'kaneo_apikey',
    prompt: '🔑 Enter your Kaneo API key:',
  },
  youtrack: {
    key: 'youtrack_token',
    prompt: '🔑 Enter your YouTrack token:',
  },
}

function createStep(id: string, key: WizardStep['key'], prompt: string, isOptional?: boolean): WizardStep {
  return {
    id,
    key,
    prompt,
    validate: (value: string) => Promise.resolve(validateStep(key, value)),
    isOptional,
  }
}

export function getWizardSteps(taskProvider: TaskProvider): WizardStep[] {
  const providerStep = PROVIDER_SPECIFIC_STEP[taskProvider]

  return [
    createStep('llm_apikey', 'llm_apikey', '🔑 Enter your LLM API key:'),
    createStep('llm_baseurl', 'llm_baseurl', '🌐 Enter base URL (e.g., https://api.openai.com/v1):'),
    createStep('main_model', 'main_model', '🤖 Enter main model name (e.g., gpt-5.4, claude-sonnet-4-6):'),
    createStep('small_model', 'small_model', "⚡ Enter small model name (or 'same' to use main model):"),
    createStep(
      'embedding_model',
      'embedding_model',
      '📊 Enter embedding model for semantic search (skip to disable):',
      true,
    ),
    createStep(providerStep.key, providerStep.key, providerStep.prompt),
    createStep('timezone', 'timezone', '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5):'),
  ]
}

function validateApiKey(value: string): string | null {
  return value.trim().length === 0 ? 'API key cannot be empty' : null
}

function validateToken(value: string): string | null {
  return value.trim().length === 0 ? 'Token cannot be empty' : null
}

function validateUrl(value: string): string | null {
  const trimmedValue = value.trim()
  try {
    const url = new URL(trimmedValue)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Please enter a valid URL (http/https)'
    }
    return null
  } catch {
    return 'Please enter a valid URL (http/https)'
  }
}

function validateModel(value: string): string | null {
  return value.trim().length === 0 ? 'Model name cannot be empty' : null
}

function validateTimezone(value: string): string | null {
  return normalizeTimezone(value.trim()) === null
    ? 'Invalid timezone. Please enter a valid IANA timezone (e.g., America/New_York, UTC) or UTC offset (e.g., UTC+5)'
    : null
}

export function validateStep(stepId: string, value: string): Promise<string | null> {
  const result = ((): string | null => {
    switch (stepId) {
      case 'llm_apikey':
      case 'kaneo_apikey':
      case 'kaneo_workspace_id':
        return validateApiKey(value)
      case 'youtrack_token':
        return validateToken(value)
      case 'llm_baseurl':
        return validateUrl(value)
      case 'main_model':
      case 'small_model':
      case 'embedding_model':
        return validateModel(value)
      case 'timezone':
        return validateTimezone(value)
      default:
        return null
    }
  })()

  return Promise.resolve(result)
}

export function getStepByIndex(taskProvider: TaskProvider, index: number): WizardStep | undefined {
  const steps = getWizardSteps(taskProvider)
  return steps[index]
}

function getDisplayValue(key: ConfigKey, value: string | undefined): string {
  if (value === undefined || value === '') {
    return 'Not set'
  }
  return maskValue(key, value)
}

export function formatSummary(data: Record<string, string | undefined>, taskProvider: TaskProvider): string {
  const lines = ['Configuration Summary', '===================', '']

  // LLM Configuration
  lines.push(`LLM API Key: ${getDisplayValue('llm_apikey', data['llm_apikey'])}`)
  lines.push(`Base URL: ${getDisplayValue('llm_baseurl', data['llm_baseurl'])}`)
  lines.push(`Main Model: ${getDisplayValue('main_model', data['main_model'])}`)
  lines.push(`Small Model: ${getDisplayValue('small_model', data['small_model'])}`)

  const embeddingModel = data['embedding_model']
  if (embeddingModel !== undefined) {
    lines.push(`Embedding Model: ${embeddingModel}`)
  }

  lines.push('')

  // Provider-specific
  if (taskProvider === 'kaneo') {
    lines.push(`Kaneo API Key: ${getDisplayValue('kaneo_apikey', data['kaneo_apikey'])}`)
    lines.push(`Kaneo Workspace ID: ${getDisplayValue('kaneo_workspace_id', data['kaneo_workspace_id'])}`)
  } else if (taskProvider === 'youtrack') {
    lines.push(`YouTrack Token: ${getDisplayValue('youtrack_token', data['youtrack_token'])}`)
  }

  lines.push('')

  // Preferences
  lines.push(`Timezone: ${getDisplayValue('timezone', data['timezone'])}`)

  return lines.join('\n')
}
