// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor - standalone configuration field editing
 * Provides button-based UI for editing individual config fields
 * Separate from the wizard - no singleStep hack needed
 */

export { handleEditorCallback, handleEditorMessage, startEditor } from './handlers.js'
export {
  matchesCallbackTargetTag,
  parseCallbackData,
  resolveCallbackKey,
  serializeCallbackData,
} from './callback-data.js'
export {
  createEditorSession,
  deleteEditorSession,
  getEditorSession,
  hasActiveEditor,
  updateEditorSession,
} from './state.js'
export type {
  ConfigEditorSession,
  CreateEditorSessionParams,
  EditorButton,
  EditorProcessResult,
  ValidationResult,
} from './types.js'
