// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  providerForResolveContext,
  registerCommandForManagedInstance,
  registerInteractionHandlerForManagedInstance,
  resolveActiveManagedInstance,
  routedMessageHandler,
} from './router-helpers.js'
import type { ManagedChatInstance } from './router-types.js'
import type {
  ChatButton,
  CommandHandler,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from './types.js'

/** Proactive interactive-button send. `supported: false` means the provider has no button method — nothing was sent; the caller should fall back to markdown. */
export const sendProactiveButtonsReturningIdForManagedInstance = async (
  instances: Map<string, ManagedChatInstance>,
  isInstanceActive: (id: string) => boolean,
  platformInstanceId: string,
  target: DeferredDeliveryTarget,
  markdown: string,
  buttons: ChatButton[],
): Promise<{ delivered: boolean; messageId: string | null; supported: boolean }> => {
  const instance = resolveActiveManagedInstance(instances, isInstanceActive, platformInstanceId, 'proactive buttons')
  if (instance === null) return { delivered: false, messageId: null, supported: true }
  const { provider } = instance
  if (typeof provider.sendButtonsReturningId !== 'function') {
    return { delivered: false, messageId: null, supported: false }
  }
  const messageId = await provider.sendButtonsReturningId(platformInstanceId, target, markdown, buttons)
  return { delivered: messageId !== null, messageId, supported: true }
}

/** Wires up command/message/interaction handlers already registered on the router onto a newly-added instance. */
export const registerExistingHandlersForInstance = (
  instance: ManagedChatInstance,
  commandHandlers: Map<string, CommandHandler>,
  messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null,
  interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null,
): void => {
  for (const [name, handler] of commandHandlers.entries()) {
    registerCommandForManagedInstance(instance, name, handler)
  }
  if (messageHandler !== null) {
    instance.provider.onMessage(routedMessageHandler(instance.id, messageHandler))
  }
  if (interactionHandler !== null) {
    registerInteractionHandlerForManagedInstance(instance, interactionHandler)
  }
}

/** Pushes slash-command metadata to `instance`, invoking `onError` (and rethrowing) if the provider call fails. */
export const setCommandsForManagedInstance = async (
  instance: ManagedChatInstance,
  adminUserId: string,
  onError: (error: unknown) => void,
): Promise<void> => {
  if (instance.provider.setCommands === undefined) return
  try {
    await instance.provider.setCommands(adminUserId)
  } catch (error) {
    onError(error)
    throw error
  }
}

/** Registers `handler` under `name` on every currently-managed instance. */
export const registerCommandForAllManagedInstances = (
  instances: Iterable<ManagedChatInstance>,
  name: string,
  handler: CommandHandler,
): void => {
  for (const instance of instances) {
    registerCommandForManagedInstance(instance, name, handler)
  }
}

/** Subscribes `handler` to every currently-managed instance's message stream. */
export const onMessageForAllManagedInstances = (
  instances: Iterable<ManagedChatInstance>,
  handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>,
): void => {
  for (const instance of instances) {
    instance.provider.onMessage(routedMessageHandler(instance.id, handler))
  }
}

/** Subscribes `handler` to every currently-managed instance's interaction stream. */
export const onInteractionForAllManagedInstances = (
  instances: Iterable<ManagedChatInstance>,
  handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>,
): void => {
  for (const instance of instances) {
    registerInteractionHandlerForManagedInstance(instance, handler)
  }
}

/** Resolves a username to a user id via the provider servicing `context`. */
export const resolveUserIdForManagedInstance = (
  instances: Map<string, ManagedChatInstance>,
  username: string,
  context: ResolveUserContext,
): Promise<string | null> => {
  const provider = providerForResolveContext(instances, context)
  if (provider === null || provider.resolveUserId === undefined) return Promise.resolve(null)
  return provider.resolveUserId(username, context)
}

/** Resolves a user id to a display label via the provider servicing `context`. */
export const resolveUserLabelForManagedInstance = (
  instances: Map<string, ManagedChatInstance>,
  userId: string,
  context: ResolveUserContext | undefined,
): Promise<string | null> => {
  const provider = context === undefined ? null : providerForResolveContext(instances, context)
  if (provider === null || provider.resolveUserLabel === undefined) return Promise.resolve(null)
  return provider.resolveUserLabel(userId, context)
}
