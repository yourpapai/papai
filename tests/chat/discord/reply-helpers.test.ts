import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createDiscordReplyFn, type SendableChannel } from '../../../src/chat/discord/reply-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

type SendArg = Partial<{
  content: string
  components: unknown[]
  reply: { messageReference: string; failIfNotExists: boolean }
  embeds: unknown[]
}>

type EditArg = Partial<{ content: string; components: unknown[] }>

function getContent(arg: SendArg | EditArg): string {
  return arg.content ?? ''
}

function assertHasReply(send: SendArg | undefined): asserts send is SendArg & { reply: NonNullable<SendArg['reply']> } {
  assert(send !== undefined, 'Expected a send to exist')
  assert(send.reply !== undefined, 'Expected a reply reference on the send')
}

function assertComponents(
  send: SendArg | undefined,
): asserts send is SendArg & { components: NonNullable<SendArg['components']> } {
  assert(send !== undefined, 'Expected a send to exist')
  assert(send.components !== undefined, 'Expected button components to be sent')
}

function assertEmbeds(
  payload: SendArg | undefined,
): asserts payload is SendArg & { embeds: NonNullable<SendArg['embeds']> } {
  assert(payload !== undefined, 'Expected a payload to exist')
  assert(payload.embeds !== undefined, 'Expected embeds on the payload')
}

describe('createDiscordReplyFn', () => {
  beforeEach(() => {
    mockLogger()
  })

  function makeChannel(): { sends: SendArg[]; typingCalls: number[]; channel: SendableChannel } {
    const sends: SendArg[] = []
    const typingCalls: number[] = []
    return {
      sends,
      typingCalls,
      channel: {
        id: 'chan-1',
        send: (arg: SendArg) => {
          sends.push(arg)
          return Promise.resolve({ id: `bot-msg-${String(sends.length)}`, edit: () => Promise.resolve() })
        },
        sendTyping: () => {
          typingCalls.push(Date.now())
          return Promise.resolve()
        },
      },
    }
  }

  test('text() sends content via channel.send', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.text('hello')
    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('hello')
  })

  test('text() sets reply.messageReference when replyToMessageId is provided', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: 'parent-1' })
    await reply.text('yo')
    const firstSend = sends[0]
    expect(firstSend).toBeDefined()
    assertHasReply(firstSend)
    expect(firstSend.reply.messageReference).toBe('parent-1')
    expect(firstSend.reply.failIfNotExists).toBe(false)
  })

  test('formatted() chunks long input into multiple sends', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.formatted('x'.repeat(4500))
    expect(sends.length).toBeGreaterThanOrEqual(3)
    for (const s of sends) {
      expect(getContent(s).length).toBeLessThanOrEqual(2000)
    }
  })

  test('typing() calls channel.sendTyping', () => {
    const { channel, typingCalls } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    reply.typing()
    expect(typingCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('file() is not exposed since messages.files is not supported', () => {
    const { channel } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    expect(reply.file).toBeUndefined()
  })

  test('redactMessage() edits the last bot-authored message', async () => {
    const { channel } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.text('first reply')
    await expect(reply.redactMessage!('[redacted]')).resolves.toBeUndefined()
  })

  test('redactMessage() edits all chunks when multi-chunk message was sent', async () => {
    const { channel, sends } = makeChannel()
    const edits: { id: string; content: string }[] = []

    // Override channel.send to capture edit calls
    channel.send = (arg: SendArg): Promise<{ id: string; edit: (editArg: EditArg) => Promise<unknown> }> => {
      sends.push(arg)
      // Get the message ID and override edit method
      const msgId = `bot-msg-${String(sends.length)}`
      return Promise.resolve({
        id: msgId,
        edit: (editArg: EditArg): Promise<void> => {
          edits.push({ id: msgId, content: getContent(editArg) })
          return Promise.resolve()
        },
      })
    }

    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    // Send a message that will be chunked (>2000 chars)
    const longContent = 'x'.repeat(4500)
    await reply.formatted(longContent)

    // Should have sent multiple chunks
    expect(sends.length).toBeGreaterThanOrEqual(3)

    // Redact should edit all chunks
    await reply.redactMessage!('[redacted]')

    // All chunks should have been edited
    expect(edits.length).toBe(sends.length)
    for (const edit of edits) {
      expect(edit.content).toBe('[redacted]')
    }
  })

  test('buttons() builds action rows and sends', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    await reply.buttons('choose', {
      buttons: [
        { text: 'Yes', callbackData: 'cb:y', style: 'primary' },
        { text: 'No', callbackData: 'cb:n', style: 'danger' },
      ],
    })
    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('choose')
    expect(Array.isArray(sends[0]!.components)).toBe(true)
    assertComponents(sends[0])
    expect(sends[0].components.length).toBe(1)
  })

  test('replaceButtons() edits the interaction-origin message instead of sending a new one', async () => {
    const { channel, sends } = makeChannel()
    const edits: EditArg[] = []
    const replaceMessage = {
      id: 'interaction-msg-1',
      edit: (arg: EditArg): Promise<void> => {
        edits.push(arg)
        return Promise.resolve()
      },
    }

    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined, replaceMessage })

    await reply.replaceButtons!('Choose again', {
      buttons: [
        { text: 'Retry', callbackData: 'cb:retry', style: 'primary' },
        { text: 'Cancel', callbackData: 'cb:cancel', style: 'secondary' },
      ],
    })

    expect(sends).toHaveLength(0)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.content).toBe('Choose again')
    expect(Array.isArray(edits[0]!.components)).toBe(true)
    assertComponents(edits[0])
    expect(edits[0].components.length).toBe(1)
  })

  test('replaceText() clears components on the interaction-origin message', async () => {
    const { channel, sends } = makeChannel()
    const edits: EditArg[] = []
    const replaceMessage = {
      id: 'interaction-msg-1',
      edit: (arg: EditArg): Promise<void> => {
        edits.push(arg)
        return Promise.resolve()
      },
    }

    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined, replaceMessage })

    await reply.replaceText!('Done')

    expect(sends).toHaveLength(0)
    expect(edits).toEqual([{ content: 'Done', components: [] }])
  })

  test('replaceText() falls back to normal sending when replaceMessage is absent', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    await reply.replaceText!('Fallback text')

    expect(sends).toHaveLength(1)
    expect(sends[0]).toEqual({ content: 'Fallback text', reply: undefined })
  })

  test('replaceButtons() falls back to normal sending with components when replaceMessage is absent', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    await reply.replaceButtons!('Fallback buttons', {
      buttons: [
        { text: 'Retry', callbackData: 'cb:retry', style: 'primary' },
        { text: 'Cancel', callbackData: 'cb:cancel', style: 'secondary' },
      ],
    })

    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('Fallback buttons')
    expect(Array.isArray(sends[0]!.components)).toBe(true)
    assertComponents(sends[0])
    expect(sends[0].components.length).toBe(1)
  })

  test('embed() sends an embed via channel.send', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    expect(reply.embed).toBeDefined()
    await reply.embed!({
      title: 'Context · gpt-4o',
      description: '🟦🟦⬜',
      fields: [{ name: 'System prompt', value: '820 tk' }],
      footer: '6,770 / 128,000 tokens',
      color: 0x2ecc71,
    })

    expect(sends).toHaveLength(1)
    const payload = sends[0]
    expect(typeof payload).toBe('object')
    expect(payload).not.toBeNull()
    assertEmbeds(payload)
    expect(Array.isArray(payload.embeds)).toBe(true)
    expect(payload.embeds).toHaveLength(1)
  })

  test('embed() handles embeds without optional fields', async () => {
    const { channel, sends } = makeChannel()
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    await reply.embed!({
      title: 'Minimal',
      description: 'Just the basics',
    })
    expect(sends).toHaveLength(1)
    const payload = sends[0]
    expect(typeof payload).toBe('object')
    expect(payload).not.toBeNull()
    assertEmbeds(payload)
    expect(Array.isArray(payload.embeds)).toBe(true)
    expect(payload.embeds).toHaveLength(1)
  })
})
