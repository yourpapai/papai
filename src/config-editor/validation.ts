// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor validation functions
 * Validates user input for configuration fields
 */

import type { ConfigField } from '../types/config.js'
import { normalizeTimezone } from '../utils/timezone.js'

export interface ValidationResult {
  valid: boolean
  error?: string
}

function validateTimezone(value: string): ValidationResult {
  const normalized = normalizeTimezone(value.trim())
  if (normalized === null) {
    return {
      valid: false,
      error:
        'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.',
    }
  }
  return { valid: true }
}

export function validateConfigField(field: ConfigField, value: string): ValidationResult {
  if (field.required && value.trim().length === 0) {
    return { valid: false, error: `${field.label} cannot be empty` }
  }
  if (field.storageKey === 'timezone') return validateTimezone(value)
  if (field.options !== undefined && value !== '' && !field.options.some((option) => option.value === value)) {
    const allowed = field.options.map((option) => option.value).join(', ')
    return { valid: false, error: `${field.label} must be one of: ${allowed}` }
  }
  return { valid: true }
}
