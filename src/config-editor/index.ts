/**
 * Config Editor - standalone configuration field editing
 * Provides button-based UI for editing individual config fields
 * Separate from the wizard - no singleStep hack needed
 */

export { handleEditorCallback, handleEditorMessage, startEditor } from './handlers.js'
export { parseCallbackData, serializeCallbackData } from './callback-data.js'
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
