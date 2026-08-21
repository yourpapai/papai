// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildScopedCommandAuth } from '../../../src/chat/command-auth.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
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

export type ScenarioProactiveDeliveryOutcome = 'sent' | 'failed' | 'throws'

export type ScenarioProactiveDeliveryPlan = Readonly<{
  contextId: string
  outcomes: readonly ScenarioProactiveDeliveryOutcome[]
}>

type ScenarioProactiveAttempt = Readonly<{
  contextId: string
  platformInstanceId: string
  markdown: string
}>

export type ScenarioChat = Omit<ChatProvider, 'onInteraction'> &
  RuntimeIngress &
  Readonly<{
    onInteraction: NonNullable<ChatProvider['onInteraction']>
    resolveUserLabel: NonNullable<ChatProvider['resolveUserLabel']>
    allReplies(): readonly ScenarioReply[]
    addGroupAdmin(groupId: string, userId: string): void
    /** Seed the label a userId resolves to; an Error makes the lookup reject. */
    setUserLabel(userId: string, label: string | Error): void
    configureProactiveDelivery(plans: readonly ScenarioProactiveDeliveryPlan[]): void
    proactiveAttempts(): readonly ScenarioProactiveAttempt[]
  }>

const clone = <T>(value: T): T => structuredClone(value)
const complete = (): Promise<void> => Promise.resolve()

const cloneMessage = (message: IncomingMessage): IncomingMessage => {
  const { files, fileCandidates, replyContext, user, ...fields } = message
  return {
    ...fields,
    user: { ...user },
    ...(replyContext === undefined ? {} : { replyContext: clone(replyContext) }),
    ...(files === undefined
      ? {}
      : {
          files: files.map((file) => ({
            ...file,
            content: Buffer.from(file.content),
          })),
        }),
    ...(fileCandidates === undefined ? {} : { fileCandidates: fileCandidates.map((candidate) => ({ ...candidate })) }),
  }
}

const cloneInteraction = (interaction: IncomingInteraction): IncomingInteraction => ({
  ...interaction,
  user: { ...interaction.user },
})

type RegisteredCommand = Readonly<{ handler: CommandHandler; match: string }>

const registeredCommandFor = (
  text: string,
  commands: ReadonlyMap<string, CommandHandler>,
): RegisteredCommand | undefined => {
  const parsed = /^\/([^\s@/]+)(?:@[^\s]+)?([\s\S]*)$/u.exec(text)
  if (parsed === null) return undefined
  const name = parsed[1]
  if (name === undefined) return undefined
  const handler = commands.get(name)
  if (handler === undefined) return undefined
  return { handler, match: (parsed[2] ?? '').trim() }
}

export function createScenarioChat(scenarioName: string, events: ScenarioEvents): ScenarioChat {
  let state: LifecycleState = 'new'
  let messageHandler: MessageHandler | undefined
  let interactionHandler: InteractionHandler | undefined
  let replies: readonly ScenarioReply[] = []
  const proactiveOutcomes = new Map<string, ScenarioProactiveDeliveryOutcome[]>()
  let proactiveAttempts: readonly ScenarioProactiveAttempt[] = []
  const commands = new Map<string, CommandHandler>()
  const groupAdmins = new Set<string>()
  const userLabels = new Map<string, string | Error>()

  const hasGroupAdmin = (platformInstanceId: string, nativeGroupId: string, userId: string): boolean =>
    groupAdmins.has(`${toScopedContextId({ platformInstanceId, nativeContextId: nativeGroupId })}:${userId}`)

  const withSeededGroupAdmin = (message: IncomingMessage): IncomingMessage => {
    if (message.contextType !== 'group') return message
    if (!hasGroupAdmin(message.platformInstanceId, message.contextId, message.user.id)) return message
    return { ...message, user: { ...message.user, isAdmin: true } }
  }

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
    ]),
    traits: { observedGroupMessages: 'all' },
    configRequirements: [],
    registerCommand(name, handler): void {
      if (commands.has(name)) {
        throw new Error(events.formatFailure(`command handler already registered: ${name}`))
      }
      commands.set(name, handler)
    },
    onMessage(handler): void {
      if (messageHandler !== undefined) {
        throw new Error(events.formatFailure('message handler already registered'))
      }
      messageHandler = handler
    },
    onInteraction(handler): void {
      if (interactionHandler !== undefined) {
        throw new Error(events.formatFailure('interaction handler already registered'))
      }
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
      proactiveAttempts = [...proactiveAttempts, { contextId: target.contextId, platformInstanceId, markdown }]
      const outcome = proactiveOutcomes.get(target.contextId)?.shift() ?? 'sent'
      if (outcome === 'throws') return Promise.reject(new Error('Scripted proactive delivery failure'))
      return Promise.resolve(outcome === 'sent')
    },
    renderContext(snapshot: ContextSnapshot) {
      return { method: 'text', content: JSON.stringify(snapshot) }
    },
    isGroupAdmin(platformInstanceId, groupId, userId): Promise<boolean> {
      return Promise.resolve(hasGroupAdmin(platformInstanceId, groupId, userId))
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
      const normalized = withSeededGroupAdmin(cloneMessage(message))
      const command = registeredCommandFor(normalized.text, commands)
      if (command !== undefined) {
        const commandMessage = { ...normalized, commandMatch: command.match }
        events.record('chat.message', commandMessage)
        await command.handler(
          commandMessage,
          createReply(commandMessage),
          buildScopedCommandAuth(commandMessage, commandMessage.user.isAdmin, commandMessage.platformInstanceId),
        )
        return
      }
      const handler = messageHandler
      if (handler === undefined) return
      events.record('chat.message', normalized)
      await handler(normalized, createReply(normalized))
    },
    async dispatchInteraction(interaction): Promise<void> {
      assertDispatchable('interaction')
      const handler = interactionHandler
      if (handler === undefined) return
      const normalized = cloneInteraction(interaction)
      events.record('chat.interaction', normalized)
      await handler(normalized, createReply(normalized))
    },
    allReplies: () => clone(replies),
    configureProactiveDelivery(plans): void {
      if (state !== 'new') {
        throw new Error(events.formatFailure('proactive delivery must be configured before chat start'))
      }
      const configuredOutcomes = new Map<string, ScenarioProactiveDeliveryOutcome[]>()
      for (const plan of plans) {
        if (plan.contextId.length === 0) {
          throw new Error(events.formatFailure('proactive delivery context ID cannot be empty'))
        }
        if (plan.outcomes.length === 0) {
          throw new Error(events.formatFailure('proactive delivery outcomes cannot be empty'))
        }
        if (configuredOutcomes.has(plan.contextId)) {
          throw new Error(events.formatFailure(`duplicate proactive delivery context ID: ${plan.contextId}`))
        }
        configuredOutcomes.set(plan.contextId, [...plan.outcomes])
      }
      proactiveOutcomes.clear()
      for (const [contextId, outcomes] of configuredOutcomes) {
        proactiveOutcomes.set(contextId, outcomes)
      }
    },
    proactiveAttempts: () => clone(proactiveAttempts),
    addGroupAdmin(groupId: string, userId: string): void {
      groupAdmins.add(`${groupId}:${userId}`)
    },
    setUserLabel(userId: string, label: string | Error): void {
      userLabels.set(userId, label)
    },
    // Unseeded ids resolve to null, matching a real provider that does not know the user.
    resolveUserLabel(userId: string): Promise<string | null> {
      const label = userLabels.get(userId)
      if (label === undefined) return Promise.resolve(null)
      if (label instanceof Error) return Promise.reject(label)
      return Promise.resolve(label)
    },
  }
}
