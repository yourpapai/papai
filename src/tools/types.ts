import type { ContextType } from '../chat/types.js'
export type { ContextType } from '../chat/types.js'

export type ToolMode = 'normal' | 'proactive'

/**
 * Options for makeTools function.
 * Use this options object pattern for clarity - the single storageContextId
 * parameter replaces the confusing userId/contextId split.
 */
export type MakeToolsOptions = {
  /**
   * The storage context ID for the user/conversation.
   * This single identifier is used for:
   * - User-scoped tools (memos, recurring tasks, instructions)
   * - Group history lookup (if the ID contains a group/thread suffix)
   * - Attachment tools
   */
  storageContextId?: string
  /**
   * The actual chat user ID (different from storageContextId in group chats).
   * Used for identity tools to ensure per-user isolation.
   * In DMs, this is the same as storageContextId.
   * In groups, this is the actual user ID while storageContextId is the group ID.
   */
  chatUserId: string
  /**
   * The chat username for the current actor when the platform provides one.
   * Used by tools that persist delivery metadata for later platform-native mentions.
   */
  username?: string | null
  /**
   * Tool mode: 'normal' (default) includes deferred prompt tools,
   * 'proactive' excludes them for proactive delivery contexts.
   */
  mode?: ToolMode
  /**
   * The context type: 'dm' for direct messages, 'group' for group chats.
   * Used to conditionally include/exclude tools that should only be available
   * in specific contexts (e.g., identity tools are only available in groups).
   */
  contextType?: ContextType
  stagedDownloadFn?: import('../attachments/types.js').StagedFileDownloadFn
}
