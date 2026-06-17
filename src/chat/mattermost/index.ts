// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { getSettingsPublicBaseUrl } from '../../settings/config.js'
import { buildScopedCommandAuth } from '../command-auth.js'
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
import { checkChannelAdmin } from './channel-helpers.js'
import { resolveMattermostConfig, type MattermostConstructorConfig } from './config.js'
import { fetchMattermostChannelInfo, fetchMattermostTeamInfo, type MattermostChannelInfo } from './context-metadata.js'
import { renderMattermostContext } from './context-renderer.js'
import {
  cacheIncomingPost,
  downloadMattermostFile,
  parsePostedEvent,
  resolveMattermostPostFiles,
  resolveMattermostUserId,
  uploadMattermostFile,
} from './file-helpers.js'
import { resolveMattermostGroupLabel, resolveMattermostUserLabel } from './label-helpers.js'
import { determineMattermostThreadId, normalizeMattermostMessageText } from './message-normalization.js'
import { mattermostCapabilities, mattermostConfigRequirements, mattermostTraits } from './metadata.js'
import { buildMattermostReplyContext } from './reply-context.js'
import { createMattermostReplyFn, sendMattermostDeferredMessage } from './reply-helpers.js'
import { extractReplyId, MattermostWsEventSchema, type MattermostPost, UserMeSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost' })

type PostedMessageResult = {
  msg: IncomingMessage
  reply: ReplyFn
  command: { handler: CommandHandler; match: string } | null
  isAdmin: boolean
}

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

  isGroupAdmin(_platformInstanceId: string, groupId: string, userId: string): Promise<boolean> {
    return checkChannelAdmin(groupId, userId, this.apiFetch.bind(this))
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
    const wsUrl = this.baseUrl.replace(/^http/u, 'ws') + '/api/v4/websocket'
    log.debug({ wsUrl }, 'Connecting to Mattermost WebSocket')
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.addEventListener('open', () => {
      log.debug('Mattermost WebSocket connected, authenticating')
      this.wsSend({
        seq: this.wsSeq++,
        action: 'authentication_challenge',
        data: { token: this.token },
      })
    })
    ws.addEventListener('message', (event) => {
      void this.handleWsMessage(event)
    })
    ws.addEventListener('close', () => {
      log.warn('Mattermost WebSocket closed, reconnecting in 5s')
      setTimeout(() => {
        this.connectWebSocket()
      }, 5000)
    })
    ws.addEventListener('error', (event) => {
      log.error({ event }, 'Mattermost WebSocket error')
    })
  }

  private async handleWsMessage(event: MessageEvent): Promise<void> {
    const parsed = MattermostWsEventSchema.safeParse(JSON.parse(String(event.data)))
    if (!parsed.success) return
    if (parsed.data.event === 'hello') {
      log.info('Mattermost WebSocket authenticated')
      return
    }
    if (parsed.data.event === 'posted') {
      await this.handlePostedEvent(parsed.data.data)
    }
  }

  private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
    const parsed = parsePostedEvent(data)
    if (parsed === null) return
    const { post, senderName } = parsed
    if (post.user_id === this.botUserId) return
    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    cacheIncomingPost(post, replyToMessageId, senderName)
    const { msg, reply, command, isAdmin } = await this.buildPostedMessage(post, senderName, replyToMessageId)
    if (msg.isMentioned && msg.text === '') {
      const mentionHelp =
        this.botUsername === null ? 'Use `/help` to see commands' : `Use \`@${this.botUsername} /help\` to see commands`
      await reply.text(`${mentionHelp}, or mention me with a question.`)
      return
    }
    if (command !== null) {
      const auth = buildScopedCommandAuth(msg, isAdmin, this.platformInstanceId)
      await command.handler(msg, reply, auth)
      return
    }
    if (this.messageHandler !== null) await this.messageHandler(msg, reply)
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
  private async apiFetch(method: string, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Mattermost API ${method} ${path} failed: ${res.status}`)
    return res.json() as Promise<unknown>
  }
  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderMattermostContext(snapshot)
  }
}
