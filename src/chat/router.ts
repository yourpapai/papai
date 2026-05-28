// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { AttachmentSourceProvider } from '../attachments/types.js'
import { getContextSettings } from '../instances/context-store.js'
import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import {
  activeManagedInstances,
  capabilitiesForManagedInstance,
  downloadFileFromManagedInstance,
  errorMessage,
  managedInstanceOrNull,
  managedInstanceSnapshots,
  providerForManagedInstance,
  renderContextForManagedInstance,
  renderContextFromManagedInstances,
  threadCapabilitiesForManagedInstances,
  traitsForManagedInstance,
  traitsForManagedInstances,
} from './router-helpers.js'
import type { ManagedChatInstance, ManagedChatInstanceFactory, ManagedChatInstanceSnapshot } from './router-types.js'
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

export type { ManagedChatInstance, ManagedChatInstanceFactory, ManagedChatInstanceSnapshot } from './router-types.js'

const log = logger.child({ scope: 'chat:router' })
const ROUTER_LIFECYCLE_CONCURRENCY = 4

export class ChatRouter implements ChatProvider {
  readonly name = 'router'
  readonly configRequirements = []

  private readonly instances = new Map<string, ManagedChatInstance>()
  private readonly commandHandlers = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null

  constructor(private readonly factory: ManagedChatInstanceFactory) {}

  get threadCapabilities(): ThreadCapabilities {
    return threadCapabilitiesForManagedInstances(this.instances.values())
  }

  get capabilities(): ReadonlySet<ChatCapability> {
    return new Set(this.activeInstances().flatMap((instance) => Array.from(instance.provider.capabilities)))
  }

  get traits(): ChatProviderTraits {
    return traitsForManagedInstances(this.instances.values())
  }

  addInstance(id: string, type: PlatformInstanceType, config: InstanceConfig): ManagedChatInstance {
    if (this.instances.has(id)) {
      throw new Error(`Chat instance already exists: ${id}`)
    }
    const provider = this.factory(id, type, config)
    const instance: ManagedChatInstance = { id, type, provider, status: 'pending' }
    this.instances.set(id, instance)
    this.registerExistingHandlers(instance)
    return instance
  }

  async removeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    instance.status = 'stopped'
    try {
      await instance.provider.stop()
    } catch (error) {
      log.warn({ platformInstanceId: id, error: errorMessage(error) }, 'failed to stop chat instance during removal')
    } finally {
      this.instances.delete(id)
    }
  }

  getInstance(id: string): ManagedChatInstance | null {
    return managedInstanceOrNull(this.instances.get(id))
  }
  isInstanceActive(platformInstanceId: string): boolean {
    const instance = this.instances.get(platformInstanceId)
    return instance !== undefined && instance.status === 'active'
  }
  listInstances(): readonly ManagedChatInstanceSnapshot[] {
    return managedInstanceSnapshots(this.instances.values())
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

    instance.status = 'stopped'
    await instance.provider.stop()
  }

  async start(): Promise<void> {
    const limit = pLimit(ROUTER_LIFECYCLE_CONCURRENCY)
    await Promise.all([...this.instances.values()].map((instance) => limit(() => this.startInstance(instance.id))))
  }

  async stop(): Promise<void> {
    const limit = pLimit(ROUTER_LIFECYCLE_CONCURRENCY)
    await Promise.all([...this.instances.values()].map((instance) => limit(() => this.stopInstanceSafely(instance))))
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

  async sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<boolean> {
    const instance = this.instances.get(platformInstanceId)
    if (instance === undefined || instance.status !== 'active') {
      log.warn({ platformInstanceId }, 'cannot route message to inactive or unknown chat instance')
      return false
    }
    const result = await instance.provider.sendMessage(platformInstanceId, target, markdown)
    return result !== false
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderContextFromManagedInstances(this.instances.values(), snapshot)
  }

  renderContextForInstance(platformInstanceId: string, snapshot: ContextSnapshot): ContextRendered {
    return renderContextForManagedInstance(
      this.instances.get(platformInstanceId),
      this.renderContext(snapshot),
      snapshot,
    )
  }

  async setCommands(adminUserId: string): Promise<void> {
    const limit = pLimit(ROUTER_LIFECYCLE_CONCURRENCY)
    await Promise.all(
      this.activeInstances().map((instance) => limit(() => this.setCommandsForInstance(instance, adminUserId))),
    )
  }

  getInstanceTraits(platformInstanceId: string): ChatProviderTraits | null {
    return traitsForManagedInstance(this.instances.get(platformInstanceId))
  }

  getPlatformInstanceCapabilities(platformInstanceId: string): ReadonlySet<ChatCapability> {
    return capabilitiesForManagedInstance(this.instances.get(platformInstanceId))
  }

  downloadFileFromInstance(
    platformInstanceId: string,
    sourceProvider: AttachmentSourceProvider,
    fileId: string,
  ): Promise<Buffer | null> {
    return downloadFileFromManagedInstance(this.instances.get(platformInstanceId), sourceProvider, fileId)
  }

  resolveUserId(username: string, context: ResolveUserContext): Promise<string | null> {
    const provider = this.providerForResolveContext(context)
    if (provider === null) return Promise.resolve(null)
    if (provider.resolveUserId === undefined) return Promise.resolve(null)
    return provider.resolveUserId(username, context)
  }

  resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    const provider = context === undefined ? null : this.providerForResolveContext(context)
    if (provider === null) return Promise.resolve(null)
    if (provider.resolveUserLabel === undefined) return Promise.resolve(null)
    return provider.resolveUserLabel(userId, context)
  }

  resolveGroupLabel(groupId: string): Promise<string | null> {
    const settings = getContextSettings(groupId)
    if (settings === null) return Promise.resolve(null)
    const instance = this.instances.get(settings.platformInstanceId)
    if (instance === undefined) return Promise.resolve(null)
    if (instance.provider.resolveGroupLabel === undefined) return Promise.resolve(null)
    return instance.provider.resolveGroupLabel(groupId)
  }

  private activeInstances(): ManagedChatInstance[] {
    return activeManagedInstances(this.instances.values())
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
    if (instance.provider.onInteraction === undefined) return
    instance.provider.onInteraction((interaction, reply) =>
      handler({ ...interaction, platformInstanceId: instance.id }, reply),
    )
  }

  private providerForResolveContext(context: ResolveUserContext): ChatProvider | null {
    const platformInstanceId = this.platformInstanceIdForResolveContext(context)
    if (platformInstanceId === null) return null
    return providerForManagedInstance(this.instances.get(platformInstanceId))
  }

  private platformInstanceIdForResolveContext(context: ResolveUserContext): string | null {
    if (context.platformInstanceId !== undefined) return context.platformInstanceId
    const settings = getContextSettings(context.contextId)
    if (settings === null) return null
    return settings.platformInstanceId
  }

  private async stopInstanceSafely(instance: ManagedChatInstance): Promise<void> {
    try {
      await this.stopInstance(instance.id)
    } catch (error) {
      instance.status = 'stopped'
      log.error({ platformInstanceId: instance.id, error: errorMessage(error) }, 'failed to stop chat instance')
    }
  }

  private async setCommandsForInstance(instance: ManagedChatInstance, adminUserId: string): Promise<void> {
    if (instance.provider.setCommands === undefined) return
    try {
      await instance.provider.setCommands(adminUserId)
    } catch (error) {
      log.warn({ platformInstanceId: instance.id, error: errorMessage(error) }, 'failed to set chat commands')
      throw error
    }
  }
}
