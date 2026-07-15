// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { getSettingsPublicBaseUrl } from '../../settings/config.js'
import type {
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  ContextType,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../types.js'
import {
  dispatchMattermostProviderAction,
  registerMattermostActionDispatcher,
  unregisterMattermostActionDispatcher,
  type MattermostActionPayload,
  type MattermostActionResponse,
} from './action-callbacks.js'
import { getMattermostActionSigningSecret } from './action-secret.js'
import { createMattermostActionContext } from './action-signing.js'
import { makeMattermostApiFetch } from './api-fetch.js'
import { triggerMattermostCatchUpOnHello } from './catch-up-deps.js'
import { checkChannelAdmin } from './channel-helpers.js'
import { resolveMattermostConfig, type MattermostConstructorConfig } from './config.js'
import { fetchMattermostChannelInfo, fetchMattermostTeamInfo, type MattermostChannelInfo } from './context-metadata.js'
import { renderMattermostContext } from './context-renderer.js'
import {
  downloadMattermostFile,
  parsePostedEvent,
  resolveMattermostPostFiles,
  resolveMattermostUserId,
  uploadMattermostFile,
} from './file-helpers.js'
import { resolveMattermostGroupLabel, resolveMattermostUserLabel } from './label-helpers.js'
import { determineMattermostThreadId, normalizeMattermostMessageText } from './message-normalization.js'
import { mattermostCapabilities, mattermostConfigRequirements, mattermostTraits } from './metadata.js'
import {
  cachePostOnly as cachePostOnlyPipeline,
  processPost as processPostPipeline,
  type PostedMessageResult,
} from './process-post.js'
import { setMattermostReaction } from './reactions.js'
import { buildMattermostReplyContext } from './reply-context.js'
import { createMattermostReplyFn, sendMattermostDeferredMessage } from './reply-helpers.js'
import { MattermostWsEventSchema, type MattermostPost, UserMeSchema } from './schema.js'
import { connectMattermostWebSocket } from './websocket.js'

const log = logger.child({ scope: 'chat:mattermost' })

export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  readonly threadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'post' as const,
  }
  readonly capabilities = mattermostCapabilities
  readonly traits = mattermostTraits
  readonly configRequirements = mattermostConfigRequirements
  private readonly baseUrl: string
  private readonly token: string
  private readonly platformInstanceId: string
  private readonly mmFetch: import('./file-helpers.js').MattermostApiFetch
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null
  private ws: WebSocket | null = null
  private botUserId: string | null = null
  private botUsername: string | null = null
  private wsSeq = 1

  constructor(config: MattermostConstructorConfig) {
    const resolved = resolveMattermostConfig(config)
    this.baseUrl = resolved.baseUrl
    this.token = resolved.token
    this.platformInstanceId = resolved.platformInstanceId
    this.mmFetch = makeMattermostApiFetch(this.baseUrl, this.token)
    log.debug({ platformInstanceId: this.platformInstanceId }, 'MattermostChatProvider constructed')
  }
  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
  }

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
  }

  async sendMessage(_platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    await sendMattermostDeferredMessage(this.botUserId, target, markdown, this.apiFetch.bind(this))
  }

  async sendMessageReturningId(_pi: string, target: DeferredDeliveryTarget, markdown: string): Promise<string | null> {
    return (await sendMattermostDeferredMessage(this.botUserId, target, markdown, this.apiFetch.bind(this))) ?? null
  }

  isGroupAdmin(_platformInstanceId: string, groupId: string, userId: string): Promise<boolean> {
    return checkChannelAdmin(groupId, userId, this.apiFetch.bind(this))
  }

  setReaction(
    _platformInstanceId: string,
    _target: DeferredDeliveryTarget,
    messageId: string,
    emoji: string | null,
    previousEmoji?: string | null,
  ): Promise<boolean> {
    return setMattermostReaction(this.apiFetch.bind(this), this.botUserId, messageId, emoji, previousEmoji)
  }

  async start(): Promise<void> {
    const data = await this.apiFetch('GET', '/api/v4/users/me', void 0)
    const user = UserMeSchema.parse(data)
    this.botUserId = user.id
    this.botUsername = typeof user.username === 'string' ? user.username : null
    log.info({ botUserId: this.botUserId, botUsername: this.botUsername }, 'Mattermost bot started')
    registerMattermostActionDispatcher(this.platformInstanceId, (payload) => this.dispatchMattermostAction(payload))
    this.connectWebSocket()
  }

  stop(): Promise<void> {
    unregisterMattermostActionDispatcher(this.platformInstanceId)
    if (this.ws !== null) this.ws.close()
    this.ws = null
    log.info('Mattermost bot stopped')
    return Promise.resolve()
  }

  private connectWebSocket(): void {
    this.ws = connectMattermostWebSocket({
      baseUrl: this.baseUrl,
      token: this.token,
      nextSeq: () => this.wsSeq++,
      onMessage: (event) => {
        void this.handleWsMessage(event)
      },
      onReconnect: () => {
        this.connectWebSocket()
      },
    })
  }

  private async handleWsMessage(event: MessageEvent): Promise<void> {
    const parsed = MattermostWsEventSchema.safeParse(JSON.parse(String(event.data)))
    if (!parsed.success) return
    if (parsed.data.event === 'hello') {
      log.info('Mattermost WebSocket authenticated')
      triggerMattermostCatchUpOnHello(this.platformInstanceId, this.mmFetch, this.processPost, this.cachePostOnly)
      return
    }
    if (parsed.data.event === 'posted') await this.handlePostedEvent(parsed.data.data)
  }

  private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
    const parsed = parsePostedEvent(data)
    if (parsed === null) return
    await this.processPost(parsed.post, parsed.senderName)
  }

  // Arrow field (auto-bound): passed directly as a callback to the `hello` catch-up trigger.
  private readonly processPost = async (post: MattermostPost, senderName: string | undefined): Promise<void> => {
    await processPostPipeline(post, senderName, {
      platformInstanceId: this.platformInstanceId,
      botUserId: this.botUserId,
      botUsername: this.botUsername,
      buildPostedMessage: this.buildPostedMessage.bind(this),
      messageHandler: this.messageHandler,
    })
  }

  /** Cache-only path for catch-up's stale branch. Not private: catch-up-deps.js calls this. */
  readonly cachePostOnly = (post: MattermostPost, senderName: string | undefined): Promise<void> => {
    cachePostOnlyPipeline(post, senderName, {
      platformInstanceId: this.platformInstanceId,
      botUserId: this.botUserId,
    })
    return Promise.resolve()
  }

  async buildPostedMessage(
    post: MattermostPost,
    senderName: string | undefined,
    replyToMessageId: string | undefined,
  ): Promise<PostedMessageResult> {
    const api = this.apiFetch.bind(this)
    const replyContext =
      replyToMessageId === undefined ? undefined : await buildMattermostReplyContext(post, replyToMessageId, api)
    const channelInfo: MattermostChannelInfo = await fetchMattermostChannelInfo(api, post.channel_id)
    const contextType: ContextType = channelInfo.type === 'D' ? 'dm' : 'group'
    const teamId = contextType === 'group' ? channelInfo.team_id : undefined
    const teamInfo = teamId === undefined ? null : await fetchMattermostTeamInfo(api, teamId)
    const isAdmin = await checkChannelAdmin(post.channel_id, post.user_id, api)
    const normalized = normalizeMattermostMessageText(post.message, this.botUsername)
    const isMentioned = normalized.isMentioned
    const threadId = determineMattermostThreadId(post, isMentioned, contextType, replyToMessageId)
    const reply = this.buildReplyFn(post.channel_id, post.id, threadId)
    const command = normalized.commandInput === null ? null : this.matchCommand(normalized.commandInput)
    const uname = post.user_name
    const username = typeof uname === 'string' ? uname : typeof senderName === 'string' ? senderName : null
    const dispName = typeof channelInfo.display_name === 'string' ? channelInfo.display_name : channelInfo.name
    const contextName =
      contextType === 'group' ? (typeof dispName === 'string' ? dispName : post.channel_id) : undefined
    const pt = contextType === 'group' ? teamInfo : null
    const contextParentName = pt === null ? undefined : typeof pt.display_name === 'string' ? pt.display_name : pt.name
    const { files, fileCandidates } = await resolveMattermostPostFiles(
      post.file_ids,
      contextType === 'group',
      this.apiFetch.bind(this),
      (fid) => downloadMattermostFile(this.baseUrl, this.token, fid),
    )
    const msg: IncomingMessage = {
      user: { id: post.user_id, username, isAdmin },
      contextId: post.channel_id,
      contextType,
      contextName,
      contextParentName,
      isMentioned,
      text: normalized.text,
      platformInstanceId: this.platformInstanceId,
      commandMatch: command === null ? undefined : command.match,
      messageId: post.id,
      replyToMessageId,
      replyContext,
      threadId,
      ...(files ? { files } : {}),
      ...(fileCandidates ? { fileCandidates } : {}),
    }
    return { msg, reply, command, isAdmin }
  }

  private matchCommand(text: string): { handler: CommandHandler; match: string } | null {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/')) return null
    for (const [name, handler] of this.commands) {
      if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
        const match = trimmed.slice(name.length + 1).trim()
        return { handler, match }
      }
    }
    return null
  }

  private buildReplyFn(channelId: string, postId: string | undefined, threadId: string | undefined): ReplyFn {
    return createMattermostReplyFn({
      channelId,
      postId,
      threadId,
      getWsSeq: () => this.wsSeq++,
      apiFetch: this.apiFetch.bind(this),
      wsSend: this.wsSend.bind(this),
      uploadFile: (uploadChannelId, content, filename) =>
        uploadMattermostFile(this.baseUrl, this.token, uploadChannelId, content, filename),
      platformInstanceId: this.platformInstanceId,
      callbackBaseUrl: getSettingsPublicBaseUrl(),
      createActionContext: (input) => createMattermostActionContext(input, getMattermostActionSigningSecret()),
    })
  }

  private dispatchMattermostAction(payload: MattermostActionPayload): Promise<MattermostActionResponse> {
    return dispatchMattermostProviderAction(payload, {
      platformInstanceId: this.platformInstanceId,
      apiFetch: this.apiFetch.bind(this),
      interactionHandler: this.interactionHandler,
    })
  }

  resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
    return resolveMattermostUserId(username, this.apiFetch.bind(this))
  }
  resolveGroupLabel(groupId: string): Promise<string | null> {
    return resolveMattermostGroupLabel(this.apiFetch.bind(this), groupId)
  }
  downloadFile(fileId: string): Promise<Buffer | null> {
    return downloadMattermostFile(this.baseUrl, this.token, fileId)
  }
  resolveUserLabel(userId: string, _context?: ResolveUserContext): Promise<string | null> {
    return resolveMattermostUserLabel(this.apiFetch.bind(this), userId)
  }
  private wsSend(data: unknown): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data))
  }
  private apiFetch(method: string, path: string, body: unknown): Promise<unknown> {
    return this.mmFetch(method, path, body)
  }
  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderMattermostContext(snapshot)
  }
}
