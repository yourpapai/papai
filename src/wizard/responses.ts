// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getWizardSession } from './state.js'
import { getStepByIndex } from './steps.js'
import type { WizardButton, WizardProcessResult } from './types.js'

const buildSkipButtons = (stepKey: string): WizardButton[] | undefined => {
  if (stepKey === 'small_model') {
    return [{ text: 'Use same as main model', action: 'skip_small_model', style: 'secondary' }]
  }
  if (stepKey === 'embedding_model') {
    return [{ text: 'Skip (no semantic search)', action: 'skip_embedding', style: 'secondary' }]
  }
  return undefined
}

export function buildPendingWizardResponse(
  userId: string,
  storageContextId: string,
  prompt: string,
  stepIsSensitive: boolean,
): WizardProcessResult {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    return { handled: true, response: prompt, requiresInput: true, isSensitiveKey: stepIsSensitive }
  }

  const currentStep = getStepByIndex(session.taskProvider, session.currentStep)
  if (currentStep === undefined) {
    return { handled: true, response: prompt, requiresInput: true, isSensitiveKey: stepIsSensitive }
  }

  const skipButtons = buildSkipButtons(currentStep.key)
  if (skipButtons === undefined) {
    return { handled: true, response: prompt, requiresInput: true, isSensitiveKey: stepIsSensitive }
  }

  return {
    handled: true,
    response: prompt,
    requiresInput: true,
    buttons: skipButtons,
    isSensitiveKey: stepIsSensitive,
  }
}
