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
    createStep(providerStep.key, providerStep.key, providerStep.prompt),
    createStep(
      'timezone',
      'timezone',
      '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5). UTC offsets are accepted and saved as a standard timezone:',
    ),
  ]
}

function validateApiKey(value: string): string | null {
  return value.trim().length === 0 ? 'API key cannot be empty' : null
}

function validateToken(value: string): string | null {
  return value.trim().length === 0 ? 'Token cannot be empty' : null
}

function validateTimezone(value: string): string | null {
  return normalizeTimezone(value.trim()) === null
    ? 'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.'
    : null
}

export function validateStep(stepId: string, value: string): Promise<string | null> {
  const result = ((): string | null => {
    switch (stepId) {
      case 'kaneo_apikey':
      case 'kaneo_workspace_id':
        return validateApiKey(value)
      case 'youtrack_token':
        return validateToken(value)
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
