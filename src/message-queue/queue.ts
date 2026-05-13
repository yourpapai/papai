import type { ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import type { QueueItem, CoalescedItem } from './types.js'

const log = logger.child({ scope: 'message-queue' })

const DEBOUNCE_MS = 500

interface BufferedMessage {
  item: QueueItem
  reply: ReplyFn
}

export class MessageQueue {
  private readonly storageContextId: string
  private messages: BufferedMessage[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastUserId: string | null = null
  private handler: ((coalesced: CoalescedItem) => Promise<void>) | null = null
  private handlerChain: Promise<void> = Promise.resolve()

  constructor(storageContextId: string) {
    this.storageContextId = storageContextId
    log.debug({ storageContextId }, 'MessageQueue created')
  }

  setHandler(handler: (coalesced: CoalescedItem) => Promise<void>): void {
    this.handler = handler
  }

  getHandler(): ((coalesced: CoalescedItem) => Promise<void>) | null {
    return this.handler
  }

  enqueue(item: QueueItem, reply: ReplyFn): CoalescedItem | null {
    const isGroup = item.contextType === 'group'
    const hasBufferedItems = this.messages.length > 0
    const isDifferentUser = this.lastUserId !== null && this.lastUserId !== item.userId

    if (isGroup && hasBufferedItems && isDifferentUser) {
      const flushed = this.forceFlush()
      this.messages.push({ item, reply })
      this.lastUserId = item.userId
      this.resetTimer()
      return flushed
    }

    this.messages.push({ item, reply })
    this.lastUserId = item.userId

    log.debug(
      {
        userId: item.userId,
        storageContextId: this.storageContextId,
        contextType: item.contextType,
        bufferedCount: this.messages.length,
      },
      'Message enqueued',
    )

    this.resetTimer()
    return null
  }

  getBufferedCount(): number {
    return this.messages.length
  }

  private resetTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.handlerChain = this.handlerChain.then(() => this.flushAndHandle())
    }, DEBOUNCE_MS)
  }

  private async flushAndHandle(): Promise<void> {
    const result = this.flush()
    if (result !== null && this.handler !== null) {
      try {
        await this.handler(result)
      } catch (error) {
        log.error(
          { storageContextId: this.storageContextId, error: error instanceof Error ? error.message : String(error) },
          'Handler error during flush',
        )
      }
    }
  }

  private collectMessageContent(isThread: boolean): {
    texts: string[]
    attachmentIds: string[]
  } {
    const texts: string[] = []
    const attachmentIds: string[] = []
    for (const msg of this.messages) {
      if (isThread && msg.item.username !== null) {
        texts.push(`[@${msg.item.username}]: ${msg.item.text}`)
      } else {
        texts.push(msg.item.text)
      }
      attachmentIds.push(...msg.item.newAttachmentIds)
    }
    return { texts, attachmentIds }
  }

  private flush(): CoalescedItem | null {
    if (this.messages.length === 0) return null

    const attachmentCount = this.messages.reduce((count, msg) => count + msg.item.newAttachmentIds.length, 0)
    log.debug(
      { storageContextId: this.storageContextId, itemCount: this.messages.length, attachmentCount },
      'Flushing queue',
    )

    const firstMessage = this.messages[0]!
    const lastMessage = this.messages.at(-1)
    if (lastMessage === undefined) return null

    const isThread = firstMessage.item.contextType === 'group' && this.storageContextId.includes(':')
    const isDm = firstMessage.item.contextType === 'dm'
    const { texts, attachmentIds } = this.collectMessageContent(isThread)
    const text = isDm ? texts.join('\n\n') : texts.join('\n')

    const result: CoalescedItem = {
      text,
      userId: lastMessage.item.userId,
      username: lastMessage.item.username,
      storageContextId: this.storageContextId,
      configContextId: lastMessage.item.configContextId,
      contextType: lastMessage.item.contextType,
      newAttachmentIds: attachmentIds,
      reply: lastMessage.reply,
    }

    this.messages = []
    this.lastUserId = null

    return result
  }

  forceFlush(): CoalescedItem | null {
    log.info({ storageContextId: this.storageContextId, itemCount: this.messages.length }, 'Force flush requested')

    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.flush()
  }
}
