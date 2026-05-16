// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getAllConfig, isSensitiveKey, maskValue } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'

const log = logger.child({ scope: 'wizard:engine' })
import { buildPendingWizardResponse } from './responses.js'
import { validateAndSaveWizardConfig } from './save.js'
import { createWizardSession, getWizardSession, updateWizardSession, deleteWizardSession } from './state.js'
import { getWizardSteps, getStepByIndex, formatSummary } from './steps.js'
import type { WizardButton, WizardProcessResult } from './types.js'

type TaskProvider = 'kaneo' | 'youtrack'

interface CreateWizardResult {
  readonly success: boolean
  readonly prompt: string
}

interface AdvanceStepResult {
  readonly success: boolean
  readonly prompt: string
  readonly complete?: boolean
  readonly skipped?: boolean
}

const WELCOME_MESSAGE = `Welcome to papai configuration wizard!

I'll guide you through setting up your configuration step by step.
You can type "cancel" at any time to exit, or "skip" for optional steps.

Let's begin!`

function normalizeValue(
  key: ConfigKey,
  value: string,
  data: Readonly<Record<string, string | undefined>>,
  existingValue?: string,
): string {
  const trimmedValue = value.trim().toLowerCase()
  if (trimmedValue === 'same' && key === 'small_model') return data['main_model'] ?? value
  if (trimmedValue === 'skip') return existingValue !== undefined && existingValue !== '' ? existingValue : ''
  return value.trim()
}

export function getNextPrompt(userId: string, storageContextId: string): string {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return 'Error: Wizard session not found'

  const step = getStepByIndex(session.taskProvider, session.currentStep)
  if (step === undefined) return 'Error: Invalid step index'

  const existingValue = session.data[step.key]
  if (existingValue !== undefined && existingValue !== '') {
    const maskedValue = maskValue(step.key, existingValue)
    return `${step.prompt}\n\n💡 Current value: ${maskedValue} (type new value to change, or "skip" to keep)`
  }

  return step.prompt
}

function showSummary(userId: string, storageContextId: string): string {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return 'Error: Wizard session not found'

  const summary = formatSummary(session.data, session.taskProvider)
  return `${summary}\n\nIs this correct? (yes/confirm to save and validate, or type "edit" to review, or "cancel" to exit)`
}

function getCompletedStepSensitivity(userId: string, storageContextId: string): boolean {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    return false
  }

  const completedStep = getStepByIndex(session.taskProvider, session.currentStep - 1)
  return completedStep !== undefined && isSensitiveKey(completedStep.key)
}

function handleSkipCommand(
  session: NonNullable<ReturnType<typeof getWizardSession>>,
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  userId: string,
  storageContextId: string,
): AdvanceStepResult {
  const existingValue = session.data[currentStep.key]
  const hasExistingValue = existingValue !== undefined && existingValue !== ''

  if (currentStep.isOptional !== true && !hasExistingValue) {
    return {
      success: false,
      prompt: `❌ This step is required and cannot be skipped.\n\n${currentStep.prompt}`,
    }
  }

  updateWizardSession(userId, storageContextId, {
    currentStep: session.currentStep + 1,
    skippedSteps: hasExistingValue ? [] : [session.currentStep],
  })

  log.info({ userId, storageContextId, stepIndex: session.currentStep }, 'Step skipped')

  const nextSession = getWizardSession(userId, storageContextId)
  if (nextSession === null) return { success: false, prompt: 'Error: Session lost' }

  if (nextSession.currentStep >= nextSession.totalSteps) {
    return { success: true, prompt: showSummary(userId, storageContextId), complete: true, skipped: true }
  }

  return { success: true, prompt: getNextPrompt(userId, storageContextId), skipped: true }
}

async function validateAndStoreValue(
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  value: string,
  skipValidation: boolean,
): Promise<string | null> {
  if (skipValidation) return null

  const validationError = await currentStep.validate(value)
  if (validationError !== null) {
    return `❌ ${validationError}\n\n${currentStep.prompt}\n\nPlease try again:`
  }

  return null
}

function completeStep(
  userId: string,
  storageContextId: string,
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  value: string,
  session: NonNullable<ReturnType<typeof getWizardSession>>,
): AdvanceStepResult {
  const existingValue = session.data[currentStep.key]
  const normalizedValue = normalizeValue(currentStep.key, value, session.data, existingValue)
  const dataUpdate: Partial<Record<ConfigKey, string>> = {}
  if (normalizedValue !== '') {
    dataUpdate[currentStep.key] = normalizedValue
  }

  updateWizardSession(userId, storageContextId, {
    currentStep: session.currentStep + 1,
    data: dataUpdate,
  })

  log.info({ userId, storageContextId, stepIndex: session.currentStep, key: currentStep.key }, 'Step completed')

  const updatedSession = getWizardSession(userId, storageContextId)
  if (updatedSession === null) return { success: false, prompt: 'Error: Session lost' }

  if (updatedSession.currentStep >= updatedSession.totalSteps) {
    return { success: true, prompt: showSummary(userId, storageContextId), complete: true }
  }

  return { success: true, prompt: getNextPrompt(userId, storageContextId) }
}

export function createWizard(userId: string, storageContextId: string, taskProvider: TaskProvider): CreateWizardResult {
  const steps = getWizardSteps(taskProvider)

  const existingConfig = getAllConfig(storageContextId)
  const initialData: Partial<Record<ConfigKey, string>> = {}

  for (const key of CONFIG_KEYS) {
    const value = existingConfig[key]
    if (value !== undefined) {
      initialData[key] = value
    }
  }

  createWizardSession({
    userId,
    storageContextId,
    totalSteps: steps.length,
    taskProvider,
    initialData,
  })

  log.info({ userId, storageContextId, taskProvider }, 'Wizard created with existing config')

  const firstStep = steps[0]
  if (firstStep === undefined) return { success: false, prompt: 'Error: No wizard steps configured' }

  const existingValue = initialData[firstStep.key]
  let prompt = firstStep.prompt
  if (existingValue !== undefined && existingValue !== '') {
    const maskedValue = maskValue(firstStep.key, existingValue)
    prompt = `${firstStep.prompt}\n\n💡 Current value: ${maskedValue} (type new value to change, or "skip" to keep)`
  }

  return { success: true, prompt: `${WELCOME_MESSAGE}\n\n${prompt}` }
}

export async function advanceStep(
  userId: string,
  storageContextId: string,
  value: string,
  skipValidation = false,
): Promise<AdvanceStepResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return { success: false, prompt: 'Error: Wizard session not found' }

  const currentStep = getStepByIndex(session.taskProvider, session.currentStep)
  if (currentStep === undefined) return { success: false, prompt: 'Error: Invalid step configuration' }

  const trimmedValue = value.trim().toLowerCase()
  if (trimmedValue === 'skip') {
    return handleSkipCommand(session, currentStep, userId, storageContextId)
  }

  const validationError = await validateAndStoreValue(currentStep, value, skipValidation)
  if (validationError !== null) {
    return { success: false, prompt: validationError }
  }

  return completeStep(userId, storageContextId, currentStep, value, session)
}

export function cancelWizard(userId: string, storageContextId: string): void {
  deleteWizardSession(userId, storageContextId)
  log.info({ userId, storageContextId }, 'Wizard cancelled')
}

export async function processWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
): Promise<WizardProcessResult> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return { handled: false }

  const trimmedText = text.trim().toLowerCase()

  if (trimmedText === 'cancel') {
    cancelWizard(userId, storageContextId)
    return {
      handled: true,
      response: '❌ Wizard cancelled. Your configuration was not saved.\n\nUse /setup to start again.',
    }
  }

  const isComplete = session.currentStep >= session.totalSteps
  if (isComplete && (trimmedText === 'yes' || trimmedText === 'confirm')) {
    const result = await validateAndSaveWizardConfig(userId, storageContextId)
    const wizardButtons: WizardButton[] | undefined = result.buttons?.map((btn) => ({
      text: btn.text,
      action: btn.action === 'wizard_edit' ? 'edit' : 'cancel',
    }))
    return { handled: true, response: result.message, buttons: wizardButtons }
  }

  const result = await advanceStep(userId, storageContextId, text)
  const stepIsSensitive = getCompletedStepSensitivity(userId, storageContextId)
  return buildPendingWizardResponse(userId, storageContextId, result.prompt, stepIsSensitive)
}

export { getWizardSteps }
