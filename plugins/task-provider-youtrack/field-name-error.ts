// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'

import { YouTrackClassifiedError } from './classify-error.js'
import { capAllowedValues } from './field-engine.js'

/**
 * Teaching error for an unrecognized custom-field name. Lists the project's available field
 * names (capped) in both the message string (the channel the model reliably reads) and the
 * structured details, so the model can self-correct in the same turn.
 */
export const unknownFieldError = (
  name: string,
  availableNames: readonly string[],
  op: 'create' | 'update',
): YouTrackClassifiedError => {
  const listed = capAllowedValues([...availableNames]).join('; ')
  const message = `Unknown custom field "${name}" for ${op}. Available fields: ${listed}`
  return new YouTrackClassifiedError(message, providerError.validationFailed('customFields', message))
}
