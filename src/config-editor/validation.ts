// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor validation functions
 * Validates user input for configuration fields
 */

import type { ConfigKey } from '../types/config.js'
import { normalizeTimezone } from '../utils/timezone.js'
import type { ValidationResult } from './types.js'

function validateRequired(value: string): ValidationResult {
  if (value.trim().length === 0) {
    return { valid: false, error: 'This field cannot be empty' }
  }
  return { valid: true }
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

export function validateConfigValue(key: ConfigKey, value: string): ValidationResult {
  switch (key) {
    case 'kaneo_apikey':
    case 'kaneo_workspace_id':
    case 'youtrack_token':
      return validateRequired(value)

    case 'timezone':
      return validateTimezone(value)

    case 'mcp_endpoints':
      return { valid: true }

    default:
      return { valid: true }
  }
}
