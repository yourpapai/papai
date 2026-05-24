// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from '../instances/context-store.js'
import type { InstanceConfig, InstanceStatus, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import type {
  ChatCapability,
  ChatProvider,
  ChatProviderTraits,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from './types.js'

export type ManagedChatInstance = {
  readonly id: string
  readonly type: PlatformInstanceType
  readonly provider: ChatProvider
  status: InstanceStatus
}

export type ManagedChatInstanceFactory = (
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
) => ChatProvider

const log = logger.child({ scope: 'chat:router' })

const fallbackThreadCapabilities: ThreadCapabilities = {
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}

const fallbackTraits: ChatProviderTraits = { observedGroupMessages: 'all' }

const fallbackContextRendered: ContextRendered = {
  method: 'text',
  content: 'No active chat provider is available to render this context.',
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class ChatRouter implements ChatProvider {
  readonly name = 'router'
  readonly configRequirements = []

  private readonly instances = new Map<string, ManagedChatInstance>()
  private readonly commandHandlers = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null

  constructor(private readonly factory: ManagedChatInstanceFactory) {}

  get threadCapabilities(): ThreadCapabilities {
    return this.firstActiveInstance()?.provider.threadCapabilities ?? fallbackThreadCapabilities
  }

  get capabilities(): ReadonlySet<ChatCapability> {
    return new Set(this.activeInstances().flatMap((instance) => [...instance.provider.capabilities]))
  }

  get traits(): ChatProviderTraits {
    return this.firstActiveInstance()?.provider.traits ?? fallbackTraits
  }

  addInstance(id: string, type: PlatformInstanceType, config: InstanceConfig): ManagedChatInstance {
    const provider = this.factory(id, type, config)
    const instance: ManagedChatInstance = { id, type, provider, status: 'pending' }
    this.instances.set(id, instance)
    this.registerExistingHandlers(instance)
    return instance
  }

  async removeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return

    try {
      await instance.provider.stop()
    } catch (error) {
      log.warn({ platformInstanceId: id, error: errorMessage(error) }, 'failed to stop chat instance during removal')
    } finally {
      this.instances.delete(id)
    }
  }

  getInstance(id: string): ManagedChatInstance | null {
    return this.instances.get(id) ?? null
  }

  async startInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) {
      log.warn({ platformInstanceId: id }, 'cannot start unknown chat instance')
      return
    }

    try {
      await instance.provider.start()
      instance.status = 'active'
    } catch (error) {
      instance.status = 'stopped'
      log.error({ platformInstanceId: id, error: errorMessage(error) }, 'failed to start chat instance')
    }
  }

  async stopInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) {
      log.warn({ platformInstanceId: id }, 'cannot stop unknown chat instance')
      return
    }

    await instance.provider.stop()
    instance.status = 'stopped'
  }

  async start(): Promise<void> {
    for (const instance of this.instances.values()) {
      await this.startInstance(instance.id)
    }
  }

  async stop(): Promise<void> {
    for (const instance of this.instances.values()) {
      await this.stopInstance(instance.id)
    }
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commandHandlers.set(name, handler)
    for (const instance of this.instances.values()) {
      this.registerCommandForInstance(instance, name, handler)
    }
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
    for (const instance of this.instances.values()) {
      instance.provider.onMessage(this.wrapMessageHandler(instance.id, handler))
    }
  }

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
    for (const instance of this.instances.values()) {
      this.registerInteractionHandler(instance, handler)
    }
  }

  async sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    const instance = this.instances.get(platformInstanceId)
    if (instance === undefined) {
      log.warn({ platformInstanceId }, 'cannot route message to unknown chat instance')
      return
    }

    await instance.provider.sendMessage(platformInstanceId, target, markdown)
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return this.firstActiveInstance()?.provider.renderContext(snapshot) ?? fallbackContextRendered
  }

  renderContextForInstance(platformInstanceId: string, snapshot: ContextSnapshot): ContextRendered {
    return this.instances.get(platformInstanceId)?.provider.renderContext(snapshot) ?? this.renderContext(snapshot)
  }

  async setCommands(adminUserId: string): Promise<void> {
    for (const instance of this.activeInstances()) {
      try {
        await instance.provider.setCommands?.(adminUserId)
      } catch (error) {
        log.warn({ platformInstanceId: instance.id, error: errorMessage(error) }, 'failed to set chat commands')
      }
    }
  }

  getInstanceTraits(platformInstanceId: string): ChatProviderTraits | null {
    return this.instances.get(platformInstanceId)?.provider.traits ?? null
  }

  async resolveUserId(username: string, context: ResolveUserContext): Promise<string | null> {
    const provider = this.providerForResolveContext(context)
    return provider?.resolveUserId?.(username, context) ?? null
  }

  async resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    const provider = context === undefined ? null : this.providerForResolveContext(context)
    return provider?.resolveUserLabel?.(userId, context) ?? null
  }

  async resolveGroupLabel(groupId: string): Promise<string | null> {
    const platformInstanceId = getContextSettings(groupId)?.platformInstanceId
    const provider = platformInstanceId === undefined ? null : this.instances.get(platformInstanceId)?.provider
    return provider?.resolveGroupLabel?.(groupId) ?? null
  }

  private activeInstances(): ManagedChatInstance[] {
    return [...this.instances.values()].filter((instance) => instance.status === 'active' || instance.status === 'pending')
  }

  private firstActiveInstance(): ManagedChatInstance | null {
    return this.activeInstances()[0] ?? null
  }

  private registerExistingHandlers(instance: ManagedChatInstance): void {
    for (const [name, handler] of this.commandHandlers.entries()) {
      this.registerCommandForInstance(instance, name, handler)
    }
    if (this.messageHandler !== null) {
      instance.provider.onMessage(this.wrapMessageHandler(instance.id, this.messageHandler))
    }
    if (this.interactionHandler !== null) {
      this.registerInteractionHandler(instance, this.interactionHandler)
    }
  }

  private registerCommandForInstance(instance: ManagedChatInstance, name: string, handler: CommandHandler): void {
    instance.provider.registerCommand(name, async (msg, reply, auth) => {
      await handler({ ...msg, platformInstanceId: instance.id }, reply, auth)
    })
  }

  private wrapMessageHandler(
    platformInstanceId: string,
    handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>,
  ): (msg: IncomingMessage, reply: ReplyFn) => Promise<void> {
    return (msg, reply) => handler({ ...msg, platformInstanceId }, reply)
  }

  private registerInteractionHandler(
    instance: ManagedChatInstance,
    handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>,
  ): void {
    instance.provider.onInteraction?.((interaction, reply) => handler({ ...interaction, platformInstanceId: instance.id }, reply))
  }

  private providerForResolveContext(context: ResolveUserContext): ChatProvider | null {
    const platformInstanceId = context.platformInstanceId ?? getContextSettings(context.contextId)?.platformInstanceId
    return platformInstanceId === undefined ? null : this.instances.get(platformInstanceId)?.provider ?? null
  }
}
