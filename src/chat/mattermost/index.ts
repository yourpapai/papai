// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getThreadScopedStorageContextId } from '../../auth.js'
import { logger } from '../../logger.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  ContextType,
  DeferredDeliveryTarget,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../types.js'
import { checkChannelAdmin } from './channel-helpers.js'
import { fetchMattermostChannelInfo, fetchMattermostTeamInfo, type MattermostChannelInfo } from './context-metadata.js'
import { renderMattermostContext } from './context-renderer.js'
import {
  buildMattermostMentionPrefix,
  cacheIncomingPost,
  downloadMattermostFile,
  parsePostedEvent,
  resolveMattermostPostFiles,
  resolveMattermostUserId,
  uploadMattermostFile,
} from './file-helpers.js'
import { resolveMattermostGroupLabel, resolveMattermostUserLabel } from './label-helpers.js'
import { mattermostCapabilities, mattermostConfigRequirements, mattermostTraits } from './metadata.js'
import { buildMattermostReplyContext } from './reply-context.js'
import { createMattermostReplyFn } from './reply-helpers.js'
import { ChannelSchema, extractReplyId, MattermostWsEventSchema, type MattermostPost, UserMeSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost' })

let mattermostFileFetcher: ((fileId: string) => Promise<Buffer | null>) | undefined

type PostedMessageResult = {
  msg: IncomingMessage
  reply: ReplyFn
  command: { handler: CommandHandler; match: string } | null
  isAdmin: boolean
}

type MattermostConstructorConfig = Partial<{
  url: string
  token: string
  platformInstanceId: string
}>

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
  private ws: WebSocket | null = null
  private botUserId: string | null = null
  private botUsername: string | null = null
  private wsSeq = 1

  constructor(config: MattermostConstructorConfig = {}) {
    const url = config.url ?? process.env['MATTERMOST_URL']
    const token = config.token ?? process.env['MATTERMOST_BOT_TOKEN']
    if (url === undefined || url.trim() === '') {
      throw new Error('MATTERMOST_URL environment variable is required')
    }
    if (token === undefined || token.trim() === '') {
      throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
    }
    this.baseUrl = url.replace(/\/+$/u, '')
    this.token = token
    this.platformInstanceId = config.platformInstanceId ?? 'legacy-single'
    log.debug({ platformInstanceId: this.platformInstanceId }, 'MattermostChatProvider constructed')
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(_platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    if (target.contextType === 'dm') {
      if (this.botUserId === null) throw new Error('Bot not started')
      const dmData = await this.apiFetch('POST', '/api/v4/channels/direct', [this.botUserId, target.contextId])
      const channelId = ChannelSchema.parse(dmData).id
      await this.apiFetch('POST', '/api/v4/posts', { channel_id: channelId, message: markdown })
      return
    }
    const mention =
      target.audience === 'personal'
        ? await buildMattermostMentionPrefix(target.mentionUserIds, target.createdByUsername, this.apiFetch.bind(this))
        : ''
    const post = {
      channel_id: target.contextId,
      message: `${mention}${markdown}`,
      ...(target.threadId === null ? {} : { root_id: target.threadId }),
    }
    await this.apiFetch('POST', '/api/v4/posts', post)
  }

  async start(): Promise<void> {
    const data = await this.apiFetch('GET', '/api/v4/users/me', void 0)
    const user = UserMeSchema.parse(data)
    this.botUserId = user.id
    this.botUsername = typeof user.username === 'string' ? user.username : null
    mattermostFileFetcher = (fileId): Promise<Buffer | null> => downloadMattermostFile(this.baseUrl, this.token, fileId)
    log.info({ botUserId: this.botUserId, botUsername: this.botUsername }, 'Mattermost bot started')
    this.connectWebSocket()
  }

  stop(): Promise<void> {
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
      this.wsSend({ seq: this.wsSeq++, action: 'authentication_challenge', data: { token: this.token } })
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
    if (command !== null) {
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: isAdmin,
        isGroupAdmin: isAdmin,
        storageContextId: getThreadScopedStorageContextId(msg.contextId, msg.contextType, msg.threadId),
      }
      await command.handler(msg, reply, auth)
    } else if (this.messageHandler !== null) {
      await this.messageHandler(msg, reply)
    }
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
    const isMentioned = this.botUsername !== null && post.message.includes(`@${this.botUsername}`)
    const threadId = this.determineThreadId(post, isMentioned, contextType, replyToMessageId)
    const reply = this.buildReplyFn(post.channel_id, post.id, threadId)
    const command = this.matchCommand(post.message)
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
      text: post.message,
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

  private determineThreadId(
    post: MattermostPost,
    isMentioned: boolean,
    contextType: ContextType,
    replyToMessageId: string | undefined,
  ): string | undefined {
    if (post.root_id !== undefined && post.root_id !== '') return post.root_id
    if (isMentioned && contextType === 'group') return post.id
    return replyToMessageId
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
      baseUrl: this.baseUrl,
      getWsSeq: () => this.wsSeq++,
      apiFetch: this.apiFetch.bind(this),
      wsSend: this.wsSend.bind(this),
      uploadFile: (uploadChannelId, content, filename) =>
        uploadMattermostFile(this.baseUrl, this.token, uploadChannelId, content, filename),
    })
  }

  resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
    return resolveMattermostUserId(username, this.apiFetch.bind(this))
  }
  resolveGroupLabel(groupId: string): Promise<string | null> {
    return resolveMattermostGroupLabel(this.apiFetch.bind(this), groupId)
  }
  resolveUserLabel(userId: string, _context?: ResolveUserContext): Promise<string | null> {
    return resolveMattermostUserLabel(this.apiFetch.bind(this), userId)
  }
  private wsSend(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data))
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

export function getMattermostFileFetcher(): ((fileId: string) => Promise<Buffer | null>) | undefined {
  return mattermostFileFetcher
}
