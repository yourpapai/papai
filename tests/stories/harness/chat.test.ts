// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IncomingInteraction, IncomingMessage } from '../../../src/chat/types.js'
import { dmTarget } from '../../../src/chat/types.js'
import { createScenarioChat } from './chat.js'
import { createScenarioEvents } from './events.js'

const MESSAGE = {
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'group-1:thread-7',
  contextType: 'group',
  isMentioned: true,
  text: 'create a task',
  platformInstanceId: 'platform-1',
  threadId: 'thread-7',
} as const satisfies IncomingMessage

const INTERACTION = {
  kind: 'button',
  user: MESSAGE.user,
  contextId: 'group-1',
  contextType: 'group',
  platformInstanceId: 'platform-1',
  storageContextId: 'group-1:thread-7',
  callbackData: 'perm:a:1',
  threadId: 'thread-7',
} as const satisfies IncomingInteraction

describe('scenario chat', () => {
  test('dispatch before handler registration names the scenario and phase', async () => {
    const events = createScenarioEvents('task creation')
    events.setPhase('when message')
    const chat = createScenarioChat('task creation', events)
    await chat.start()

    expect(chat.dispatch(MESSAGE)).rejects.toThrow('task creation')
    expect(chat.dispatch(MESSAGE)).rejects.toThrow('when message')
    expect(chat.dispatch(MESSAGE)).rejects.toThrow('message handler')
  })

  test('dispatch preserves normalized message fields and captures reply surfaces', async () => {
    const events = createScenarioEvents('chat replies')
    const chat = createScenarioChat('chat replies', events)
    let received: IncomingMessage | undefined
    chat.onMessage(async (message, reply) => {
      received = message
      await reply.text('plain reply', { threadId: message.threadId })
      await reply.formatted('**formatted reply**')
      const prompt = await reply.buttons('approve?', {
        buttons: [{ text: 'approve', callbackData: 'approve' }],
      })
      await prompt?.redact('approved')
      const status = await reply.createStatus?.('working')
      await status?.update('done')
      await status?.dismiss()
    })
    await chat.start()

    await chat.dispatch(MESSAGE)
    await chat.sendMessage('platform-1', dmTarget('user-1'), 'proactive reply')

    expect(received).toEqual(MESSAGE)
    expect(chat.allReplies().map((reply) => reply.kind)).toEqual([
      'text',
      'formatted',
      'buttons',
      'button-redact',
      'status-create',
      'status-update',
      'status-dismiss',
      'proactive',
    ])
    expect(chat.allReplies()[0]).toMatchObject({
      content: 'plain reply',
      contextId: 'group-1:thread-7',
      platformInstanceId: 'platform-1',
      threadId: 'thread-7',
      options: { threadId: 'thread-7' },
    })
    expect(chat.allReplies()[1]).toMatchObject({ threadId: 'thread-7' })
  })

  test('dispatches interactions through the registered interaction handler', async () => {
    const events = createScenarioEvents('interaction')
    const chat = createScenarioChat('interaction', events)
    chat.onInteraction(async (interaction, reply) => {
      await reply.ephemeralConfirm?.(`handled ${interaction.callbackData}`)
    })
    await chat.start()

    await chat.dispatchInteraction(INTERACTION)

    expect(chat.allReplies().find(({ kind }) => kind === 'ephemeral-confirm')).toMatchObject({
      kind: 'ephemeral-confirm',
      content: 'handled perm:a:1',
    })
  })

  test('rejects multiple handlers and dispatch after stop', async () => {
    const chat = createScenarioChat('lifecycle', createScenarioEvents('lifecycle'))
    chat.onMessage(async () => {})
    expect(() => chat.onMessage(async () => {})).toThrow('message handler already registered')
    chat.onInteraction(async () => {})
    expect(() => chat.onInteraction(async () => {})).toThrow('interaction handler already registered')
    await chat.start()
    await chat.stop()

    expect(chat.dispatch(MESSAGE)).rejects.toThrow('stopped')
    expect(chat.dispatchInteraction(INTERACTION)).rejects.toThrow('stopped')
    expect(chat.sendMessage('platform-1', dmTarget('user-1'), 'late')).rejects.toThrow('stopped')
  })

  test('duplicate registration errors include the scenario and current phase', () => {
    const events = createScenarioEvents('duplicate registration')
    events.setPhase('register handlers')
    const chat = createScenarioChat('duplicate registration', events)
    const commandHandler = (): Promise<void> => Promise.resolve()
    const messageHandler = (): Promise<void> => Promise.resolve()
    const interactionHandler = (): Promise<void> => Promise.resolve()

    chat.registerCommand('help', commandHandler)
    expect(() => chat.registerCommand('help', commandHandler)).toThrow('duplicate registration')
    expect(() => chat.registerCommand('help', commandHandler)).toThrow('phase: register handlers')

    chat.onMessage(messageHandler)
    expect(() => chat.onMessage(messageHandler)).toThrow('duplicate registration')
    expect(() => chat.onMessage(messageHandler)).toThrow('phase: register handlers')

    chat.onInteraction(interactionHandler)
    expect(() => chat.onInteraction(interactionHandler)).toThrow('duplicate registration')
    expect(() => chat.onInteraction(interactionHandler)).toThrow('phase: register handlers')
  })

  test('does not advertise unsupported user resolution', () => {
    const chat = createScenarioChat('capabilities', createScenarioEvents('capabilities'))

    expect(chat.capabilities.has('users.resolve')).toBeFalse()
    expect(chat.resolveUserId).toBeUndefined()
  })

  test('reply snapshots do not leak mutations', async () => {
    const chat = createScenarioChat('snapshots', createScenarioEvents('snapshots'))
    chat.onMessage((_message, reply) => reply.text('safe', { threadId: 'thread-1' }))
    await chat.start()
    await chat.dispatch(MESSAGE)

    const snapshot = chat.allReplies()
    Reflect.set(Object(snapshot[0]), 'content', 'mutated')

    expect(chat.allReplies()[0]).toMatchObject({ content: 'safe' })
  })
})
