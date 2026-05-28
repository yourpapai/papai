// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type {
  ChatCapability,
  ChatProvider,
  ChatProviderConfigRequirement,
  ChatProviderTraits,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingMessage,
  ReplyFn,
  ThreadCapabilities,
} from '../types.js'
import { resolveKonturTalkConfig, type KonturTalkConstructorConfig } from './config.js'
import { renderKonturTalkContext } from './context-renderer.js'
import { konturTalkCapabilities, konturTalkConfigRequirements, konturTalkTraits } from './metadata.js'
import type { KonturTalkUpdate } from './schema.js'
import { KonturTalkGetUpdatesResponseSchema } from './schema.js'

const BASE_URL = 'https://chat.ktalk.ru/_matrix/client/strangler/api/v1'

const log = logger.child({ scope: 'chat:kontur-talk' })

const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export class KonturTalkChatProvider implements ChatProvider {
  readonly name = 'kontur-talk'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'message',
  }
  readonly capabilities: ReadonlySet<ChatCapability> = konturTalkCapabilities
  readonly traits: ChatProviderTraits = konturTalkTraits
  readonly configRequirements: readonly ChatProviderConfigRequirement[] = konturTalkConfigRequirements

  private readonly jwtToken: string
  private readonly platformInstanceId: string
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private botUserId: string | null = null
  private running = false

  constructor(...args: [] | [KonturTalkConstructorConfig]) {
    const config = args[0] ?? {}
    const resolved = resolveKonturTalkConfig(config)
    this.jwtToken = resolved.jwtToken
    this.platformInstanceId = resolved.platformInstanceId
  }

  getBotUserId(): string | null {
    return this.botUserId
  }

  getPlatformInstanceId(): string {
    return this.platformInstanceId
  }

  isRunning(): boolean {
    return this.running
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
  }

  getMessageHandler(): ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null {
    return this.messageHandler
  }

  private extractBotUserId(): string {
    const parts = this.jwtToken.split('.')
    if (parts.length < 2 || parts[1] === undefined) {
      throw new Error('Invalid JWT token: missing payload')
    }
    const decoded = atob(parts[1])
    const payload: unknown = JSON.parse(decoded)
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid JWT token: invalid payload format')
    }
    const sub: unknown = Reflect.get(payload, 'sub')
    if (typeof sub !== 'string' || sub.trim() === '') {
      throw new Error('Invalid JWT token: missing sub claim')
    }
    return sub
  }

  private buildUrl(endpoint: string): string {
    return `${BASE_URL}/bot/${this.jwtToken}${endpoint}`
  }

  async apiFetch(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const url = this.buildUrl(endpoint)
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }
    const response = await fetch(url, options)
    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Kontur Talk API error ${response.status}: ${errorBody}`)
    }
    return response.json()
  }

  start(): Promise<void> {
    this.botUserId = this.extractBotUserId()
    this.running = true
    log.info({ botUserId: this.botUserId }, 'Kontur Talk bot started')
    this.schedulePoll()
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.running = false
    log.info('Kontur Talk bot stopped')
    return Promise.resolve()
  }

  private schedulePoll(): void {
    if (!this.running) return
    void this.pollOnce().then(() => {
      this.schedulePoll()
    })
  }

  private async pollOnce(): Promise<void> {
    try {
      const data = await this.apiFetch('GET', '/get_updates?timeout=30')
      const parsed = KonturTalkGetUpdatesResponseSchema.safeParse(data)
      if (!parsed.success) {
        log.warn({ error: parsed.error }, 'Failed to parse get_updates response')
        await delay(1000)
        return
      }
      await this.processUpdates(parsed.data.updates)
    } catch (e) {
      if (!this.running) return
      log.warn({ error: e instanceof Error ? e.message : String(e) }, 'Poll loop error')
      await delay(5000)
    }
  }

  private processUpdates(updates: readonly KonturTalkUpdate[]): Promise<void> {
    return updates.reduce<Promise<void>>((prev, update) => {
      if (update.user_id === this.botUserId) return prev
      return prev.then(() => this.handleUpdate(update))
    }, Promise.resolve())
  }

  private handleUpdate(_update: KonturTalkUpdate): Promise<void> {
    // Stub — implemented in Task 5
    void _update
    return Promise.resolve()
  }

  async sendMessage(_platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    if (target.contextType === 'dm') {
      log.warn('Kontur Talk does not support proactive DM delivery')
      return
    }
    await this.apiFetch('POST', '/send_message', {
      room_id: target.contextId,
      message: markdown,
      format: 'markdown',
      thread_id: target.threadId ?? null,
      mentions: [],
    })
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderKonturTalkContext(snapshot)
  }
}
