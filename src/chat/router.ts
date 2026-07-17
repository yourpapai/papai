// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { AttachmentSourceProvider } from '../attachments/types.js'
import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import {
  activeManagedInstances,
  capabilitiesForManagedInstance,
  configFingerprint,
  downloadFileFromManagedInstance,
  errorMessage,
  isGroupAdminForManagedInstance,
  managedInstanceOrNull,
  managedInstanceSnapshots,
  renderContextForManagedInstance,
  renderContextFromManagedInstances,
  resolveGroupLabelForManagedInstance,
  sendMessageForManagedInstance,
  sendProactiveReturningIdForManagedInstance,
  setReactionForManagedInstance,
  stopManagedInstanceSafely,
  threadCapabilitiesForManagedInstances,
  traitsForManagedInstance,
  traitsForManagedInstances,
} from './router-helpers.js'
import {
  onInteractionForAllManagedInstances,
  onMessageForAllManagedInstances,
  registerCommandForAllManagedInstances,
  registerExistingHandlersForInstance,
  resolveUserIdForManagedInstance,
  resolveUserLabelForManagedInstance,
  sendProactiveButtonsReturningIdForManagedInstance,
  setCommandsForManagedInstance,
} from './router-instance-helpers.js'
import type { ManagedChatInstance, ManagedChatInstanceFactory, ManagedChatInstanceSnapshot } from './router-types.js'
import type {
  ChatButton,
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
  private readonly stoppingInstances = new Set<string>()
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
    if (this.instances.has(id)) throw new Error(`Chat instance already exists: ${id}`)
    const provider = this.factory(id, type, config)
    const instance: ManagedChatInstance = {
      id,
      type,
      provider,
      status: 'pending',
      configFingerprint: configFingerprint(type, config),
    }
    this.instances.set(id, instance)
    this.registerExistingHandlers(instance)
    return instance
  }

  async removeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    try {
      await instance.provider.stop()
    } finally {
      instance.status = 'stopped'
      this.instances.delete(id)
    }
  }

  getInstance(id: string): ManagedChatInstance | null {
    return managedInstanceOrNull(this.instances.get(id))
  }
  isInstanceActive(platformInstanceId: string): boolean {
    const instance = this.instances.get(platformInstanceId)
    return instance !== undefined && instance.status === 'active' && !this.stoppingInstances.has(platformInstanceId)
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
    if (instance.status === 'active') {
      this.stoppingInstances.delete(id)
      log.debug({ platformInstanceId: id }, 'chat instance already active')
      return
    }

    this.stoppingInstances.delete(id)
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
    if (instance.status === 'stopped') {
      log.debug({ platformInstanceId: id }, 'chat instance already stopped')
      return
    }

    this.stoppingInstances.add(id)
    try {
      await instance.provider.stop()
      instance.status = 'stopped'
    } finally {
      this.stoppingInstances.delete(id)
    }
  }

  async start(): Promise<void> {
    const limit = pLimit(ROUTER_LIFECYCLE_CONCURRENCY)
    await Promise.all([...this.instances.values()].map((instance) => limit(() => this.startInstance(instance.id))))
  }

  async stop(): Promise<void> {
    const limit = pLimit(ROUTER_LIFECYCLE_CONCURRENCY)
    await Promise.all(
      [...this.instances.values()].map((instance) =>
        limit(() => stopManagedInstanceSafely(instance, (id) => this.stopInstance(id), this.stoppingInstances)),
      ),
    )
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commandHandlers.set(name, handler)
    registerCommandForAllManagedInstances(this.instances.values(), name, handler)
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
    onMessageForAllManagedInstances(this.instances.values(), handler)
  }

  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
    onInteractionForAllManagedInstances(this.instances.values(), handler)
  }

  sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<boolean> {
    return sendMessageForManagedInstance(
      this.instances,
      (id) => this.isInstanceActive(id),
      platformInstanceId,
      target,
      markdown,
    )
  }

  /** Proactive send that also returns the created root post's id (when supported). Router-only. */
  sendProactiveReturningId(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    markdown: string,
  ): Promise<{ delivered: boolean; messageId: string | null }> {
    return sendProactiveReturningIdForManagedInstance(
      this.instances,
      (id) => this.isInstanceActive(id),
      platformInstanceId,
      target,
      markdown,
    )
  }
  /** Proactive button send with a `supported` flag. Named distinctly from `ChatProvider.sendButtonsReturningId`. */
  sendProactiveButtonsReturningId(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    markdown: string,
    buttons: ChatButton[],
  ): Promise<{ delivered: boolean; messageId: string | null; supported: boolean }> {
    return sendProactiveButtonsReturningIdForManagedInstance(
      this.instances,
      (id) => this.isInstanceActive(id),
      platformInstanceId,
      target,
      markdown,
      buttons,
    )
  }
  /** Sets or clears a reaction on an existing message. Router-only; no-ops when the target provider lacks support. */
  setReaction(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    messageId: string,
    emoji: string | null,
    previousEmoji?: string | null,
  ): Promise<boolean> {
    return setReactionForManagedInstance(this.instances, platformInstanceId, target, messageId, emoji, previousEmoji)
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
    return resolveUserIdForManagedInstance(this.instances, username, context)
  }
  resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    return resolveUserLabelForManagedInstance(this.instances, userId, context)
  }
  resolveGroupLabel(groupId: string): Promise<string | null> {
    return resolveGroupLabelForManagedInstance(this.instances, groupId)
  }
  isGroupAdmin(platformInstanceId: string, groupId: string, userId: string): Promise<boolean | null> {
    return isGroupAdminForManagedInstance(this.instances.get(platformInstanceId), platformInstanceId, groupId, userId)
  }
  private activeInstances(): ManagedChatInstance[] {
    return activeManagedInstances(this.instances.values())
  }

  private registerExistingHandlers(instance: ManagedChatInstance): void {
    registerExistingHandlersForInstance(instance, this.commandHandlers, this.messageHandler, this.interactionHandler)
  }

  private setCommandsForInstance(instance: ManagedChatInstance, adminUserId: string): Promise<void> {
    return setCommandsForManagedInstance(instance, adminUserId, (error) => {
      log.warn({ platformInstanceId: instance.id, error: errorMessage(error) }, 'failed to set chat commands')
    })
  }
}
