// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  ButtonReplyOptions,
  ChatCapability,
  ChatProvider,
  CommandHandler,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ReplyOptions,
} from '../../../src/chat/types.js'
import type { RuntimeIngress } from '../../../src/runtime/types.js'
import type { ScenarioEvents } from './events.js'

type MessageHandler = (message: IncomingMessage, reply: ReplyFn) => Promise<void>
type InteractionHandler = (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>
type LifecycleState = 'new' | 'started' | 'stopped'

export type ScenarioReply = Readonly<{
  seq: number
  kind: string
  content?: string
  contextId?: string
  platformInstanceId?: string
  threadId?: string | null
  options?: unknown
  data?: unknown
}>

export type ScenarioChat = Omit<ChatProvider, 'onInteraction'> &
  RuntimeIngress &
  Readonly<{
    onInteraction: NonNullable<ChatProvider['onInteraction']>
    allReplies(): readonly ScenarioReply[]
  }>

const clone = <T>(value: T): T => structuredClone(value)
const complete = (): Promise<void> => Promise.resolve()

export function createScenarioChat(scenarioName: string, events: ScenarioEvents): ScenarioChat {
  let state: LifecycleState = 'new'
  let messageHandler: MessageHandler | undefined
  let interactionHandler: InteractionHandler | undefined
  let replies: readonly ScenarioReply[] = []
  const commands = new Map<string, CommandHandler>()

  const capture = (reply: Omit<ScenarioReply, 'seq'>): ScenarioReply => {
    const captured = { ...clone(reply), seq: replies.length + 1 } satisfies ScenarioReply
    replies = [...replies, captured]
    events.record(`chat.${captured.kind}`, captured)
    return clone(captured)
  }

  const assertDispatchable = (handlerName: string): void => {
    if (state !== 'started') {
      throw new Error(events.formatFailure(`scenario ${scenarioName}: chat is ${state}`))
    }
    const registered = handlerName === 'message' ? messageHandler !== undefined : interactionHandler !== undefined
    if (!registered) {
      throw new Error(events.formatFailure(`scenario ${scenarioName}: ${handlerName} handler is not registered`))
    }
  }

  const createReply = (source: IncomingMessage | IncomingInteraction): ReplyFn => {
    const common = {
      contextId: source.contextId,
      platformInstanceId: source.platformInstanceId,
      ...(source.threadId === undefined ? {} : { threadId: source.threadId }),
    } as const
    const withContent = (kind: string, content: string, options?: ReplyOptions): void => {
      capture({ ...common, kind, content, ...(options === undefined ? {} : { options }) })
    }
    const withButtons = (kind: string, content: string, options: ButtonReplyOptions): void => {
      capture({ ...common, kind, content, options })
    }

    const sendText = (content: string, options: ReplyOptions = {}): Promise<void> => {
      withContent('text', content, options)
      return complete()
    }
    const sendFormatted = (content: string, options: ReplyOptions = {}): Promise<void> => {
      withContent('formatted', content, options)
      return complete()
    }
    const replaceText = (content: string, options: ReplyOptions = {}): Promise<void> => {
      withContent('replace-text', content, options)
      return complete()
    }
    const file: NonNullable<ReplyFn['file']> = (value, options = {}) => {
      capture({ ...common, kind: 'file', options, data: { filename: value.filename } })
      return complete()
    }

    return {
      text: sendText,
      formatted: sendFormatted,
      typing: () => {
        capture({ ...common, kind: 'typing' })
      },
      buttons: (content, options) => {
        const handleId = `prompt-${replies.length + 1}`
        withButtons('buttons', content, options)
        return Promise.resolve({
          redact: (replacement) => {
            capture({ ...common, kind: 'button-redact', content: replacement, data: { handleId } })
            return complete()
          },
          remove: () => {
            capture({ ...common, kind: 'button-remove', data: { handleId } })
            return complete()
          },
        })
      },
      replaceText,
      file,
      redactMessage: (content) => {
        withContent('redact-message', content)
        return complete()
      },
      deleteMessage: (messageId) => {
        capture({ ...common, kind: 'delete-message', data: { messageId } })
        return complete()
      },
      replaceButtons: (content, options) => {
        withButtons('replace-buttons', content, options)
        return complete()
      },
      ephemeralConfirm: (content) => {
        withContent('ephemeral-confirm', content)
        return complete()
      },
      embed: (options) => {
        capture({ ...common, kind: 'embed', data: options })
        return complete()
      },
      createStatus: (initialText) => {
        const handleId = `status-${replies.length + 1}`
        withContent('status-create', initialText)
        return Promise.resolve({
          update: (content) => {
            capture({ ...common, kind: 'status-update', content, data: { handleId } })
            return complete()
          },
          dismiss: () => {
            capture({ ...common, kind: 'status-dismiss', data: { handleId } })
            return complete()
          },
        })
      },
    }
  }

  return {
    name: 'scenario',
    threadCapabilities: { supportsThreads: true, canCreateThreads: true, threadScope: 'message' },
    capabilities: new Set<ChatCapability>([
      'commands.menu',
      'interactions.callbacks',
      'messages.buttons',
      'messages.delete',
      'messages.ephemeral',
      'messages.files',
      'messages.redact',
      'messages.reply-context',
      'files.receive',
      'users.resolve',
    ]),
    traits: { observedGroupMessages: 'all' },
    configRequirements: [],
    registerCommand(name, handler): void {
      if (commands.has(name)) throw new Error(`command handler already registered: ${name}`)
      commands.set(name, handler)
    },
    onMessage(handler): void {
      if (messageHandler !== undefined) throw new Error('message handler already registered')
      messageHandler = handler
    },
    onInteraction(handler): void {
      if (interactionHandler !== undefined) throw new Error('interaction handler already registered')
      interactionHandler = handler
    },
    sendMessage(platformInstanceId, target: DeferredDeliveryTarget, markdown): Promise<boolean> {
      if (state !== 'started') {
        return Promise.reject(new Error(events.formatFailure(`scenario ${scenarioName}: chat is ${state}`)))
      }
      capture({
        kind: 'proactive',
        content: markdown,
        contextId: target.contextId,
        platformInstanceId,
        threadId: target.threadId,
        data: target,
      })
      return Promise.resolve(true)
    },
    renderContext(snapshot: ContextSnapshot) {
      return { method: 'text', content: JSON.stringify(snapshot) }
    },
    start(): Promise<void> {
      if (state === 'stopped') throw new Error(events.formatFailure('chat cannot restart after stop'))
      if (state === 'started') return complete()
      state = 'started'
      events.record('chat.start', { state })
      return complete()
    },
    stop(): Promise<void> {
      if (state === 'stopped') return complete()
      state = 'stopped'
      events.record('chat.stop', { state })
      return complete()
    },
    async dispatch(message): Promise<void> {
      assertDispatchable('message')
      const handler = messageHandler
      if (handler === undefined) return
      const normalized = clone(message)
      events.record('chat.message', normalized)
      await handler(normalized, createReply(normalized))
    },
    async dispatchInteraction(interaction): Promise<void> {
      assertDispatchable('interaction')
      const handler = interactionHandler
      if (handler === undefined) return
      const normalized = clone(interaction)
      events.record('chat.interaction', normalized)
      await handler(normalized, createReply(normalized))
    },
    allReplies: () => clone(replies),
  }
}
