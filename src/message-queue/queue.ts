// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import type { ReplyFn } from '../chat/types.js'
import { emitGroup, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { QueueItem, CoalescedItem } from './types.js'

const log = logger.child({ scope: 'message-queue' })

const DEBOUNCE_MS = 500

interface BufferedMessage {
  item: QueueItem
  reply: ReplyFn
}

export type QueueEmitDeps = {
  emitUser: (type: string, userId: string, data: Record<string, unknown>, turnId?: string) => void
  emitGroup: (type: string, groupId: string, data: Record<string, unknown>, turnId?: string, threadId?: string) => void
}

const defaultEmitDeps: QueueEmitDeps = { emitUser, emitGroup }

export class MessageQueue {
  private readonly storageContextId: string
  private readonly emitDeps: QueueEmitDeps
  private messages: BufferedMessage[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastUserId: string | null = null
  private handler: ((coalesced: CoalescedItem) => Promise<void>) | null = null
  private handlerChain: Promise<void> = Promise.resolve()

  constructor(storageContextId: string, emitDeps: QueueEmitDeps = defaultEmitDeps) {
    this.storageContextId = storageContextId
    this.emitDeps = emitDeps
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
      this.emitScoped('queue:enqueue', item.userId, {
        storageContextId: this.storageContextId,
        userId: item.userId,
        bufferedCount: this.messages.length,
      })
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

    this.emitScoped('queue:enqueue', item.userId, {
      storageContextId: this.storageContextId,
      userId: item.userId,
      bufferedCount: this.messages.length,
    })

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
      const startTime = Date.now()
      try {
        await this.handler(result)
        this.emitScoped(
          'turn:end',
          result.userId,
          {
            turnId: result.turnId,
            status: 'ok',
            duration: Date.now() - startTime,
          },
          result.turnId,
          result.contextType,
        )
      } catch (error) {
        log.error(
          {
            storageContextId: this.storageContextId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Handler error during flush',
        )
        this.emitScoped(
          'turn:end',
          result.userId,
          {
            turnId: result.turnId,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          },
          result.turnId,
          result.contextType,
        )
      }
    }
  }

  private collectMessageContent(isThread: boolean): {
    texts: string[]
    attachmentIds: string[]
    voiceStagedIds: string[]
  } {
    const texts: string[] = []
    const attachmentIds: string[] = []
    const voiceStagedIds: string[] = []
    for (const msg of this.messages) {
      if (isThread && msg.item.username !== null) {
        texts.push(`[@${msg.item.username}]: ${msg.item.text}`)
      } else {
        texts.push(msg.item.text)
      }
      attachmentIds.push(...msg.item.newAttachmentIds)
      voiceStagedIds.push(...msg.item.voiceStagedIds)
    }
    return { texts, attachmentIds, voiceStagedIds }
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
    const { texts, attachmentIds, voiceStagedIds } = this.collectMessageContent(isThread)
    const text = isDm ? texts.join('\n\n') : texts.join('\n')

    const turnId = randomUUID()

    const result: CoalescedItem = {
      text,
      userId: lastMessage.item.userId,
      username: lastMessage.item.username,
      storageContextId: this.storageContextId,
      configContextId: lastMessage.item.configContextId,
      contextType: lastMessage.item.contextType,
      newAttachmentIds: attachmentIds,
      voiceStagedIds,
      reply: lastMessage.reply,
      turnId,
    }

    this.messages = []
    this.lastUserId = null

    this.emitFlushEvents(result, lastMessage.item.userId, texts.length, attachmentIds.length)

    return result
  }

  private emitFlushEvents(result: CoalescedItem, userId: string, textCount: number, attachmentCount: number): void {
    this.emitScoped(
      'queue:coalesce',
      userId,
      {
        storageContextId: this.storageContextId,
        itemCount: textCount,
        attachmentCount,
      },
      undefined,
      result.contextType,
    )

    this.emitScoped(
      'turn:start',
      userId,
      {
        turnId: result.turnId,
        contextType: result.contextType,
        incomingMessageCount: textCount,
      },
      result.turnId,
      result.contextType,
    )
  }

  forceFlush(): CoalescedItem | null {
    log.info({ storageContextId: this.storageContextId, itemCount: this.messages.length }, 'Force flush requested')

    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.flush()
  }

  private emitScoped(
    type: string,
    userId: string,
    data: Record<string, unknown>,
    turnId?: string,
    contextType?: string,
  ): void {
    const effectiveContextType = contextType ?? this.messages[0]?.item.contextType
    if (effectiveContextType === 'group') {
      const separatorIndex = this.storageContextId.indexOf(':')
      const groupId = separatorIndex === -1 ? this.storageContextId : this.storageContextId.slice(0, separatorIndex)
      const threadId = separatorIndex === -1 ? undefined : this.storageContextId.slice(separatorIndex + 1)
      this.emitDeps.emitGroup(type, groupId, data, turnId, threadId)
    } else {
      this.emitDeps.emitUser(type, userId, data, turnId)
    }
  }
}
