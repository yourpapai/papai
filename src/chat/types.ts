// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Identity extracted from an incoming message. */
export type ChatUser = {
  id: string
  username: string | null
  /** platform admin in current context */
  isAdmin: boolean
} & Partial<{
  /** provider-formatted display label when the adapter already knows it */
  displayLabel: string
}>

/** Context type for messages - DM or group chat. */
export type ContextType = 'dm' | 'group'

import type { DeferredDeliveryTarget } from './deferred-target.js'
import type { ChatProviderConfigRequirement } from './provider-descriptor.js'
export type { DeferredAudience, DeferredDeliveryTarget } from './deferred-target.js'
export { dmTarget } from './deferred-target.js'
/** Context passed to resolveUserId so adapters can scope searches. */
export type ResolveUserContext = {
  /** Storage key of the conversation where the lookup originated (userId in DMs, channel/group ID in groups). */
  contextId: string
  /** 'dm' or 'group' — adapters may use this to decide whether guild-scoped search is possible. */
  contextType: ContextType
} & Partial<{
  /** Source platform instance for router delegation when context_settings is not available yet. */
  platformInstanceId: string
}>

/** Thread support capabilities for a chat platform. */
export type ThreadCapabilities = {
  /** Platform has thread/topic support */
  supportsThreads: boolean
  /** Bot can create new threads (Telegram: yes, Mattermost: no) */
  canCreateThreads: boolean
  /** Platform-specific thread identifier type */
  threadScope: 'message' | 'post'
}

/** Capability strings for chat platform features. */
export type ChatCapability =
  | 'commands.menu'
  | 'interactions.callbacks'
  | 'messages.buttons'
  | 'messages.delete'
  | 'messages.files'
  | 'messages.redact'
  | 'messages.reply-context'
  | 'files.receive'
  | 'users.resolve'

/** Behavioral traits for a chat platform. */
export type ChatProviderTraits = {
  /** Whether the bot sees all group messages or only mentions */
  observedGroupMessages: 'all' | 'mentions_only'
} & Partial<{
  /** Maximum length of a single message (platform limit) */
  maxMessageLength: number
  /** Maximum length of callback data in button interactions */
  callbackDataMaxLength: number
}>

export type {
  ChatProviderConfigField,
  ChatProviderConfigRequirement,
  ChatProviderDescriptor,
} from './provider-descriptor.js'

/** A file to send to the user. */
export type ChatFile = {
  content: Buffer | string
  filename: string
}

/** An incoming file attached to a user message. */
export type IncomingFile = {
  /** Platform-specific file identifier */
  fileId: string
  /** Human-readable filename */
  filename: string
  /** Raw file content */
  content: Buffer
} & Partial<{
  /** MIME type (if available) */
  mimeType: string
  /** File size in bytes (if available) */
  size: number
  /** How the file arrived: a recorded voice note vs an ordinary file. Default 'file'. */
  origin: 'voice' | 'file'
  /** Display name of the original sender when the message was forwarded. */
  forwardedFrom: string
}>

export type IncomingFileCandidate = {
  fileId: string
  filename: string
} & Partial<{
  mimeType: string
  size: number
  /** How the file arrived: a recorded voice note vs an ordinary file. Default 'file'. */
  origin: 'voice' | 'file'
  /** Display name of the original sender when the message was forwarded. */
  forwardedFrom: string
}>

/** Context about a message reply or quote. */
export type ReplyContext = {
  /** Platform-specific ID of the message being replied to */
  messageId: string
} & Partial<{
  /** User ID of the original message author (if available) */
  authorId: string
  /** Username of the original message author (if available) */
  authorUsername: string | null
  /** Text content of the message being replied to (if available) */
  text: string
  /** For quote-style replies, the specific quoted text */
  quotedText: string
  /** True when the quoted text was truncated by the platform API limit (Telegram: 1024 chars) */
  quotedTextTruncated: boolean
  /** Platform-specific thread/topic ID (Telegram: message_thread_id, Mattermost: root_id) */
  threadId: string
  /** Full reply chain message IDs in chronological order (oldest first) */
  chain: string[]
  /** Summary of earlier messages in the chain (excludes immediate parent) */
  chainSummary: string
}>

/** Incoming message from a user. */
export type IncomingMessage = {
  user: ChatUser
  /** storage key: userId in DMs, groupId in groups */
  contextId: string
  contextType: ContextType
  /** bot was @mentioned */
  isMentioned: boolean
  text: string
  /** ID of the chat provider instance this message arrived on. */
  platformInstanceId: string
} & Partial<{
  /** Human-readable channel/group name when the adapter knows it */
  contextName: string
  /** Human-readable workspace/team/guild label when the adapter knows it */
  contextParentName: string
  commandMatch: string
  /** platform-specific message ID for deletion */
  messageId: string
  /** parent message ID if this is a reply */
  replyToMessageId: string
  /** Reply or quote context if this message is a reply */
  replyContext: ReplyContext
  /** Files attached to this message (populated by platform adapters) */
  files: IncomingFile[]
  fileCandidates: IncomingFileCandidate[]
  /** Platform thread ID (if in thread) */
  threadId: string
  /** message is a reply to one of the bot's own messages; undefined when the adapter cannot determine this (treat as false) */
  isReplyToBot: boolean
}>

/** An incoming button interaction from a user. */
export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  /** ID of the chat provider instance this interaction arrived on. */
  platformInstanceId: string
  /**
   * Thread-scoped storage key for session/config lookup.
   * Same as contextId in DMs, groupId:threadId in forum topics.
   */
  storageContextId: string
  callbackData: string
} & Partial<{
  /** Platform-specific message ID of the interactive message */
  messageId: string
  /** Original interactive message content when the adapter can provide it. */
  sourceMessageText: string
  /** Platform thread ID (if in thread) */
  threadId: string
}>

export type AuthorizationDenyReason = 'group_not_allowed' | 'group_member_not_allowed' | 'dm_not_allowed'

/** Authorization result for message processing. */
export type AuthorizationResult = {
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
} & Partial<{ configContextId: string; reason: AuthorizationDenyReason }>

/** Command handler signature. */
export type CommandHandler = (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>

/** Options for reply functions to control threading behavior. */
export type ReplyOptions = Partial<{
  /** Reply to this specific message ID */
  replyToMessageId: string
  /** Post in this thread/topic */
  threadId: string
}>

/** Button for interactive messages */
export type ChatButton = {
  text: string
  callbackData: string
} & Partial<{ style: 'primary' | 'secondary' | 'danger' }>

/** Extended reply options with buttons */
export interface ButtonReplyOptions extends ReplyOptions, Partial<{ buttons: ChatButton[] }> {}
import type { ContextSnapshot } from './context-types.js'
export type { ContextSection, ContextSnapshot } from './context-types.js'

/** One field inside a Discord-style embed. */
export type EmbedField = {
  name: string
  value: string
} & Partial<{ inline: boolean }>

/** Options for sending a structured embed (Discord-only today). */
export type EmbedOptions = {
  title: string
  description: string
} & Partial<{
  fields: EmbedField[]
  footer: string
  color: number
}>

/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> }
  formatted: { (markdown: string): Promise<void>; (markdown: string, options: ReplyOptions): Promise<void> }
  typing: () => void
  buttons: (content: string, options: ButtonReplyOptions) => Promise<void>
} & Partial<{
  /** Replaces the current interactive message in place. Prefer only for button interaction flows; fall back to `text` when unavailable. */
  replaceText: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> }
  file: { (file: ChatFile): Promise<void>; (file: ChatFile, options: ReplyOptions): Promise<void> }
  redactMessage: (replacementText: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  /** Replaces the current interactive message in place. Prefer only for button interaction flows; fall back to `buttons` when unavailable. */
  replaceButtons: (content: string, options: ButtonReplyOptions) => Promise<void>
  /** Optional: send a structured embed. Only Discord implements this today. */
  embed: (options: EmbedOptions) => Promise<void>
}>

/** Result of `ChatProvider.renderContext` — describes how the handler should send the output. */
export type ContextRendered =
  | { method: 'text'; content: string }
  | { method: 'formatted'; content: string }
  | { method: 'embed'; embed: EmbedOptions }

/** The core interface every chat platform provider must implement. */
export type ChatProvider = {
  readonly name: string
  /** Thread support capabilities */
  readonly threadCapabilities: ThreadCapabilities
  /** Set of supported capability strings */
  readonly capabilities: ReadonlySet<ChatCapability>
  /** Behavioral traits for this platform */
  readonly traits: ChatProviderTraits
  /** Environment/config requirements for startup */
  readonly configRequirements: readonly ChatProviderConfigRequirement[]
  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  sendMessage(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    markdown: string,
  ): Promise<boolean> | Promise<void>
  renderContext(snapshot: ContextSnapshot): ContextRendered
  /** Start the bot event loop. */
  start(): Promise<void>
  /** Graceful shutdown. */
  stop(): Promise<void>
} & Partial<{
  /** Register the handler for button/callback interactions (optional). */
  onInteraction: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
  resolveUserId: (username: string, context: ResolveUserContext) => Promise<string | null>
  resolveUserLabel: (userId: string, context: ResolveUserContext | undefined) => Promise<string | null>
  resolveGroupLabel: (groupId: string) => Promise<string | null>
  renderContextForInstance: (platformInstanceId: string, snapshot: ContextSnapshot) => ContextRendered
  isInstanceActive: (platformInstanceId: string) => boolean
  /** Register the bot's command list with the platform (for command menus). */
  setCommands: (adminUserId: string) => Promise<void>
}>
