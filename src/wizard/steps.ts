// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { maskSensitiveValue, maskValue } from '../config.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { KANEO_WORKSPACE_CONFIG_KEY, type ConfigField } from '../types/config.js'
import { normalizeTimezone } from '../utils/timezone.js'
import type { WizardStep } from './types.js'

const TIMEZONE_FIELD: ConfigField = {
  key: 'timezone',
  storageKey: 'timezone',
  label: 'Timezone',
  required: true,
  sensitive: false,
  kind: 'preference',
}

const BUILTIN_PROMPTS: Record<string, string> = {
  kaneo_apikey: '🔑 Enter your Kaneo API key:',
  youtrack_token: '🔑 Enter your YouTrack token:',
  timezone:
    '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5). UTC offsets are accepted and saved as a standard timezone:',
}

function promptForField(field: ConfigField): string {
  return BUILTIN_PROMPTS[field.storageKey] ?? `🔑 Enter your ${field.label}:`
}

function displayLabelForKey(key: string, fallback: string): string {
  if (key === 'youtrack_token') return 'YouTrack Token'
  return fallback
}

function storageKeyForField(
  descriptor: NonNullable<ReturnType<typeof getTaskProviderDescriptor>>,
  field: NonNullable<ReturnType<typeof getTaskProviderDescriptor>>['contextConfigSchema'][number],
): string {
  if (descriptor.source !== 'builtin') return `plugin:${descriptor.source.plugin}:provider:${field.key}`
  if (field.storageKey !== undefined) return field.storageKey
  return field.key
}

function providerFields(taskProvider: string): ConfigField[] {
  const descriptor = getTaskProviderDescriptor(taskProvider)
  if (descriptor === undefined) return []

  return descriptor.contextConfigSchema
    .map(
      (field): ConfigField => ({
        key: field.key,
        storageKey: storageKeyForField(descriptor, field),
        label: displayLabelForKey(storageKeyForField(descriptor, field), field.label),
        required: field.required,
        sensitive: field.sensitive,
        kind: 'provider-context',
      }),
    )
    .filter((field) => field.storageKey !== KANEO_WORKSPACE_CONFIG_KEY)
}

function createStep(field: ConfigField, isOptional?: boolean): WizardStep {
  return {
    id: field.storageKey,
    key: field.storageKey,
    field,
    prompt: promptForField(field),
    validate: (value: string) => Promise.resolve(validateField(field, value)),
    isOptional,
  }
}

export function getWizardSteps(taskProvider: string): WizardStep[] {
  return [...providerFields(taskProvider).map((field) => createStep(field)), createStep(TIMEZONE_FIELD)]
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

function validateField(field: ConfigField, value: string): string | null {
  if (field.storageKey === 'kaneo_apikey' || field.storageKey === 'kaneo_workspace_id') return validateApiKey(value)
  if (field.storageKey === 'youtrack_token') return validateToken(value)
  if (field.storageKey === 'timezone') return validateTimezone(value)
  return field.required && value.trim().length === 0 ? `${field.label} cannot be empty` : null
}

export function getStepByIndex(taskProvider: string, index: number): WizardStep | undefined {
  const steps = getWizardSteps(taskProvider)
  return steps[index]
}

function getDisplayValue(field: ConfigField, value: string | undefined): string {
  if (value === undefined || value === '') {
    return 'Not set'
  }
  return field.sensitive ? maskSensitiveValue(value) : maskValue(field.storageKey, value)
}

export function formatSummary(data: Record<string, string | undefined>, taskProvider: string): string {
  const lines = ['Configuration Summary', '===================', '']

  for (const field of providerFields(taskProvider)) {
    lines.push(`${field.label}: ${getDisplayValue(field, data[field.storageKey])}`)
  }

  lines.push('')

  // Preferences
  lines.push(`Timezone: ${getDisplayValue(TIMEZONE_FIELD, data['timezone'])}`)

  return lines.join('\n')
}
