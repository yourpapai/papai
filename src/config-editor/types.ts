// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor types for standalone configuration field editing
 * Separate from wizard - no singleStep hack
 */

/**
 * User session tracking for editing a single config field
 */
export interface ConfigEditorSession {
  userId: string
  storageContextId: string
  startedAt: Date
  sessionToken: string
  editingKey: string
  pendingValue?: string
  originalMessageId?: string
}

/**
 * Parameters required to create a new config editor session
 */
export interface CreateEditorSessionParams {
  readonly userId: string
  readonly storageContextId: string
  readonly editingKey: string
  readonly originalMessageId?: string
}

/**
 * Button for config editor interactions
 */
export interface EditorButton {
  text: string
  action: 'edit' | 'save' | 'cancel' | 'back' | 'setup'
  key?: string
  sessionToken?: string
  style?: 'primary' | 'secondary' | 'danger'
}

/**
 * Result returned from processing a config editor callback
 */
export interface EditorProcessResult {
  handled: boolean
  response?: string
  buttons?: EditorButton[]
  editOriginal?: boolean
  isSensitiveKey?: boolean
}

/**
 * Validation result for config values
 */
export interface ValidationResult {
  valid: boolean
  error?: string
}
