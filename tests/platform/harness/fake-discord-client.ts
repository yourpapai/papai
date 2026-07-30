// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ButtonInteractionLike } from '../../../src/chat/discord/buttons.js'
import type {
  DiscordClientFactory,
  DispatchableMessage,
  LiveDiscordClient,
} from '../../../src/chat/discord/client-factory.js'
import type { SendableChannel } from '../../../src/chat/discord/reply-helpers.js'

type Listener = (...args: unknown[]) => void
type InteractionResponse = 'deferUpdate' | 'followUp'
type QueuedEvent = { listener: Listener; args: unknown[] }

type ChannelCall =
  | { method: 'send'; content: string | undefined }
  | { method: 'edit'; content: string | undefined }
  | { method: 'delete'; messageId: string }
  | { method: 'sendTyping' }

type FakeChannel = SendableChannel & { type: number }
type RuntimeButtonInteraction = ButtonInteractionLike & { type: 3; componentType: 2 }

export type FakeDiscordClient = {
  client: LiveDiscordClient
  factory: DiscordClientFactory
  channel: FakeChannel
  login(token: string): Promise<string>
  emitReady(): void
  emitMessage(message: DispatchableMessage): void
  emitButton(overrides?: Partial<ButtonInteractionLike>): void
  flush(): Promise<void>
  button(overrides?: Partial<ButtonInteractionLike>): ButtonInteractionLike
  sentContents(): readonly string[]
  channelCalls(): readonly ChannelCall[]
  deferUpdateCalls(): readonly undefined[]
  followUpCalls(): readonly { content: string; flags?: number; ephemeral?: boolean }[]
  assertClean(): void
}

export type FakeDiscordClientOptions = {
  botId: string
  username: string
  rejectInteractionResponse?: InteractionResponse
}

const listenersFor = (listeners: Map<string, Set<Listener>>, event: string): readonly Listener[] => {
  return [...(listeners.get(event) ?? [])]
}

const onceListenersFor = (listeners: Map<string, Set<Listener>>, event: string): readonly Listener[] => {
  const oneShot = listeners.get(event)
  listeners.delete(event)
  return [...(oneShot ?? [])]
}

export function createFakeDiscordClient(options: FakeDiscordClientOptions): FakeDiscordClient {
  const listeners = new Map<string, Set<Listener>>()
  const onceListeners = new Map<string, Set<Listener>>()
  const sends: string[] = []
  const calls: ChannelCall[] = []
  const deferred: undefined[] = []
  const followUps: Array<{ content: string; flags?: number; ephemeral?: boolean }> = []
  const eventQueue: QueuedEvent[] = []
  const pendingInteractionResponses = new Set<Promise<unknown>>()
  let sentCount = 0
  let destroyed = false

  const trackInteractionResponse = <T>(response: Promise<T>): Promise<T> => {
    pendingInteractionResponses.add(response)
    void response.then(
      () => pendingInteractionResponses.delete(response),
      () => pendingInteractionResponses.delete(response),
    )
    return response
  }

  const enqueueEvent = (listener: Listener, args: unknown[]): void => {
    eventQueue.push({ listener, args })
  }

  const enqueueListeners = (event: string, args: unknown[]): void => {
    for (const listener of listenersFor(listeners, event)) enqueueEvent(listener, args)
  }

  const enqueueOnceListeners = (event: string, args: unknown[]): void => {
    for (const listener of onceListenersFor(onceListeners, event)) enqueueEvent(listener, args)
  }

  const channel: FakeChannel = {
    id: 'channel-1',
    type: 0,
    send(payload) {
      const id = `sent-${String(++sentCount)}`
      sends.push(payload.content ?? '')
      calls.push({ method: 'send', content: payload.content })
      return Promise.resolve({
        id,
        edit(editPayload) {
          calls.push({ method: 'edit', content: editPayload.content })
          return Promise.resolve()
        },
        delete() {
          calls.push({ method: 'delete', messageId: id })
          return Promise.resolve()
        },
      })
    },
    sendTyping() {
      calls.push({ method: 'sendTyping' })
      return Promise.resolve()
    },
  }

  const client: LiveDiscordClient = {
    user: null,
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set<Listener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
      return client
    },
    once(event, listener) {
      const eventListeners = onceListeners.get(event) ?? new Set<Listener>()
      eventListeners.add(listener)
      onceListeners.set(event, eventListeners)
      return client
    },
    login(token) {
      return Promise.resolve(token)
    },
    destroy() {
      listeners.clear()
      onceListeners.clear()
      destroyed = true
      return Promise.resolve()
    },
  }

  const createButton = (overrides: Partial<ButtonInteractionLike> = {}): RuntimeButtonInteraction => ({
    type: 3,
    componentType: 2,
    user: { id: 'user-1', username: 'Ada' },
    customId: 'button-1',
    channelId: channel.id,
    channel,
    message: { id: 'message-1' },
    deferUpdate(): Promise<void> {
      deferred.push(undefined)
      if (options.rejectInteractionResponse === 'deferUpdate') {
        return trackInteractionResponse(Promise.reject(new Error('configured deferUpdate rejection')))
      }
      return trackInteractionResponse(Promise.resolve())
    },
    followUp(payload): Promise<unknown> {
      followUps.push(payload)
      if (options.rejectInteractionResponse === 'followUp') {
        return trackInteractionResponse(Promise.reject(new Error('configured followUp rejection')))
      }
      return trackInteractionResponse(Promise.resolve())
    },
    ...overrides,
  })

  return {
    client,
    factory: () => client,
    channel,
    login: (token) => client.login(token),
    emitReady() {
      client.user = { id: options.botId, username: options.username }
      const payload = { user: { id: options.botId, username: options.username } }
      enqueueListeners('ready', [payload])
      enqueueOnceListeners('ready', [payload])
    },
    emitMessage(message) {
      enqueueListeners('messageCreate', [message])
    },
    emitButton(overrides): void {
      enqueueListeners('interactionCreate', [createButton(overrides)])
    },
    async flush(): Promise<void> {
      while (eventQueue.length > 0) {
        const event = eventQueue.shift()
        if (event === undefined) continue
        event.listener(...event.args)
        await new Promise<void>((resolve) => {
          setImmediate(resolve)
        })
      }
      await Promise.allSettled(pendingInteractionResponses)
    },
    button: createButton,
    sentContents: () => sends.slice(),
    channelCalls: () => calls.slice(),
    deferUpdateCalls: () => deferred.slice(),
    followUpCalls: () => followUps.slice(),
    assertClean() {
      if (!destroyed) throw new Error('fake Discord client was not destroyed')
      if (listeners.size !== 0 || onceListeners.size !== 0) throw new Error('fake Discord client still has listeners')
      if (eventQueue.length > 0) throw new Error('fake Discord client has queued events')
      if (pendingInteractionResponses.size > 0)
        throw new Error('fake Discord client has a pending interaction response')
    },
  }
}
