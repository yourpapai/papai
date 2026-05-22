// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Confidence threshold below which a destructive tool will refuse to execute
 * and instead return a confirmation request to the LLM.
 *
 * The LLM must assess how explicitly the user requested the destructive action:
 *   1.0 — user already confirmed ("yes, do it")
 *   0.9 — direct unambiguous command ("archive the Auth project")
 *   0.7 — implied but not explicit ("clean up old projects")
 *   0.5 — very indirect or uncertain intent
 */
const CONFIDENCE_THRESHOLD = 0.85

export const confidenceField = z
  .number()
  .min(0)
  .max(1)
  .describe(
    'Your confidence (0–1) that the user explicitly wants this destructive action. ' +
      'Set 1.0 when the user has already confirmed. Set 0.9 for a direct unambiguous command. ' +
      'Set ≤0.7 when intent is indirect or inferred. ' +
      'The action will be blocked and a confirmation requested if this is below 0.85.',
  )

type ConfirmationRequired = {
  readonly status: 'confirmation_required'
  readonly message: string
}

export const checkConfidence = (confidence: number, actionDescription: string): ConfirmationRequired | null => {
  if (typeof confidence === 'number' && confidence >= CONFIDENCE_THRESHOLD) return null
  return {
    status: 'confirmation_required',
    message: `${actionDescription}? This action is irreversible — please confirm.`,
  }
}
