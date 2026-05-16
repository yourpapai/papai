// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Live validation service for wizard configuration
 * Makes real HTTP requests to verify connectivity
 */

import * as z from 'zod'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'wizard:validation' })

export interface ValidationResult {
  readonly success: boolean
  readonly message?: string
}

const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
})

export async function validateLlmApiKey(apiKey: string, baseUrl: string): Promise<ValidationResult> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 401) {
      return { success: false, message: '❌ Invalid API key. Please check and try again.' }
    }

    if (!response.ok) {
      return { success: false, message: `❌ API error: ${response.status} ${response.statusText}` }
    }

    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'API key validation failed')
    return { success: false, message: '❌ Connection failed. Please check your internet connection.' }
  }
}

export async function validateLlmBaseUrl(baseUrl: string): Promise<ValidationResult> {
  try {
    const response = await fetch(baseUrl, { method: 'HEAD' })
    if (!response.ok && response.status !== 404) {
      return { success: false, message: `❌ Server returned error: ${response.status}` }
    }
    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Base URL validation failed')
    return { success: false, message: '❌ Cannot connect to the provided URL. Please check and try again.' }
  }
}

export async function validateModelExists(
  modelName: string,
  apiKey: string,
  baseUrl: string,
): Promise<ValidationResult> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return { success: false, message: '❌ Could not fetch model list' }
    }

    const data = ModelListSchema.parse(await response.json())
    const models = data.data ?? []
    const exists = models.some((m) => m.id === modelName)

    if (!exists) {
      const suggestions = models
        .slice(0, 3)
        .map((m) => m.id)
        .join(', ')
      return {
        success: false,
        message: `❌ Model '${modelName}' not found. Some available models: ${suggestions}...`,
      }
    }

    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Model validation failed')
    return { success: false, message: '❌ Could not verify model. Please try again.' }
  }
}

/**
 * Configuration validation summary
 */
export interface ValidationSummary {
  readonly isValid: boolean
  readonly errors: readonly ValidationError[]
}

interface ValidationError {
  readonly field: string
  readonly message: string
}

/**
 * Validate all wizard configuration values at once before saving
 * This provides a summary of any issues that need fixing
 */
export async function validateWizardConfig(config: {
  apiKey: string
  baseUrl: string
  mainModel: string
  smallModel: string
}): Promise<ValidationSummary> {
  const errors: ValidationError[] = []

  // Validate API key
  const apiKeyResult = await validateLlmApiKey(config.apiKey, config.baseUrl)
  if (!apiKeyResult.success) {
    errors.push({ field: 'llm_apikey', message: apiKeyResult.message ?? 'API key validation failed' })
  }

  // Validate base URL connectivity
  const baseUrlResult = await validateLlmBaseUrl(config.baseUrl)
  if (!baseUrlResult.success) {
    errors.push({ field: 'llm_baseurl', message: baseUrlResult.message ?? 'URL validation failed' })
  }

  // Only validate models if API key is valid
  if (apiKeyResult.success) {
    // Validate main model
    const mainModelResult = await validateModelExists(config.mainModel, config.apiKey, config.baseUrl)
    if (!mainModelResult.success) {
      errors.push({ field: 'main_model', message: mainModelResult.message ?? 'Main model validation failed' })
    }

    // Validate small model (only if not using 'same')
    if (config.smallModel !== 'same') {
      const smallModelResult = await validateModelExists(config.smallModel, config.apiKey, config.baseUrl)
      if (!smallModelResult.success) {
        errors.push({ field: 'small_model', message: smallModelResult.message ?? 'Small model validation failed' })
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
