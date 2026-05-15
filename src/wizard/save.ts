// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard save and validation logic
 */

import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { deleteWizardSession, getWizardSession } from './state.js'
import { validateWizardConfig, type ValidationSummary } from './validation.js'

const log = logger.child({ scope: 'wizard:save' })

interface ValidationErrorDetail {
  field: string
  message: string
}

interface SaveWizardResult {
  readonly success: boolean
  readonly message: string
  readonly buttons?: Array<{ text: string; action: string }>
  readonly errors?: ValidationErrorDetail[]
}

interface ConfigValidationInput {
  apiKey: string
  baseUrl: string
  mainModel: string
  smallModel: string
}

function performConfigValidation(input: ConfigValidationInput): Promise<ValidationSummary> {
  return validateWizardConfig(input)
}

interface ValidationMessageResult {
  message: string
  buttons: Array<{ text: string; action: string }>
  errors: ValidationErrorDetail[]
}

function formatValidationMessage(summary: ValidationSummary): ValidationMessageResult {
  const fieldDisplayNames: Record<string, string> = {
    llm_apikey: 'API Key',
    llm_baseurl: 'Base URL',
    main_model: 'Main Model',
    small_model: 'Small Model',
  }

  const lines = ['❌ Configuration validation failed:', '', 'Please fix these issues:', '']

  for (const error of summary.errors) {
    const displayName = fieldDisplayNames[error.field] ?? error.field
    lines.push(`  • ${displayName}: ${error.message}`)
  }

  return {
    message: lines.join('\n'),
    buttons: [
      { text: '🔧 Edit Configuration', action: 'wizard_edit' },
      { text: '❌ Cancel', action: 'wizard_cancel' },
    ],
    errors: summary.errors.map((e) => ({ field: e.field, message: e.message })),
  }
}

function saveValidatedConfig(
  session: NonNullable<ReturnType<typeof getWizardSession>>,
  userId: string,
  storageContextId: string,
): SaveWizardResult {
  let savedCount = 0
  for (const [key, value] of Object.entries(session.data)) {
    if (value !== undefined && value !== '' && isConfigKey(key)) {
      setConfig(session.storageContextId, key, value)
      savedCount++
    }
  }

  deleteWizardSession(userId, storageContextId)
  log.info({ userId, storageContextId, savedCount }, 'Configuration saved')

  return {
    success: true,
    message: `✅ Configuration saved successfully! ${savedCount} setting(s) configured.\n\nYou can use /config to view your settings or /setup to modify them.`,
  }
}

export async function validateAndSaveWizardConfig(userId: string, storageContextId: string): Promise<SaveWizardResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    return { success: false, message: 'Error: Wizard session not found' }
  }

  const data = session.data
  const input: ConfigValidationInput = {
    apiKey: data['llm_apikey'] ?? '',
    baseUrl: data['llm_baseurl'] ?? '',
    mainModel: data['main_model'] ?? '',
    smallModel: data['small_model'] ?? '',
  }

  const validationResult = await performConfigValidation(input)

  if (!validationResult.isValid) {
    const formatted = formatValidationMessage(validationResult)
    return {
      success: false,
      message: formatted.message,
      buttons: formatted.buttons,
      errors: formatted.errors,
    }
  }

  return saveValidatedConfig(session, userId, storageContextId)
}
