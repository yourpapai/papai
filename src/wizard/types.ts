// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard state types for interactive configuration setup
 */

import type { ConfigField } from '../types/config.js'

/**
 * User session tracking for the configuration wizard
 */
export interface WizardSession {
  userId: string
  storageContextId: string
  startedAt: Date
  currentStep: number
  totalSteps: number
  data: WizardData
  skippedSteps: number[]
  taskProvider: string
}

/**
 * Data collected during wizard execution, keyed by config storage key.
 */
export type WizardData = Partial<Record<string, string>>

/**
 * Individual step definition in the wizard
 */
export interface WizardStep {
  id: string
  key: string
  field: ConfigField
  prompt: string
  validate: (value: string) => Promise<string | null>
  isOptional?: boolean
}

/**
 * Button for wizard interactions
 */
export interface WizardButton {
  text: string
  action: 'edit' | 'cancel' | 'skip_keep_existing'
  style?: 'primary' | 'secondary' | 'danger'
}

/**
 * Result returned from processing a wizard interaction
 */
export interface WizardProcessResult {
  handled: boolean
  response?: string
  requiresInput?: boolean
  buttons?: WizardButton[]
  isSensitiveKey?: boolean
}
