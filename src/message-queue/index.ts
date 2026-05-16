// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { emitGroup, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { MessageQueue } from './queue.js'
import { QueueRegistry } from './registry.js'
import type { CoalescedItem, QueueItem } from './types.js'

const log = logger.child({ scope: 'message-queue' })

// Singleton registry instance
const registry = new QueueRegistry()

function emitScoped(type: string, storageContextId: string, data: Record<string, unknown>, turnId?: string): void {
  const contextType = typeof data['contextType'] === 'string' ? data['contextType'] : undefined
  if (contextType === 'group') {
    const separatorIndex = storageContextId.indexOf(':')
    const groupId = separatorIndex === -1 ? storageContextId : storageContextId.slice(0, separatorIndex)
    const threadId = separatorIndex === -1 ? undefined : storageContextId.slice(separatorIndex + 1)
    emitGroup(type, groupId, data, turnId, threadId)
  } else {
    const userId = typeof data['userId'] === 'string' ? data['userId'] : storageContextId
    emitUser(type, userId, data, turnId)
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

function emitTurnEnd(
  storageContextId: string,
  coalesced: CoalescedItem,
  contextType: string,
  userId: string,
  startTime: number,
  error?: unknown,
): void {
  const isError = error !== undefined
  emitScoped(
    'turn:end',
    storageContextId,
    {
      turnId: coalesced.turnId,
      status: isError ? 'error' : 'ok',
      ...(isError ? { error: formatError(error) } : {}),
      duration: Date.now() - startTime,
      contextType,
      userId,
    },
    coalesced.turnId,
  )
}

function invokeHandlerWithEvents(
  handler: (coalesced: CoalescedItem) => Promise<void>,
  coalesced: CoalescedItem,
  item: { storageContextId: string; contextType: string; userId: string },
): void {
  emitScoped('queue:dequeue', item.storageContextId, {
    storageContextId: item.storageContextId,
    contextType: item.contextType,
    userId: item.userId,
  })
  const startTime = Date.now()
  void handler(coalesced)
    .then(() => {
      emitTurnEnd(item.storageContextId, coalesced, item.contextType, item.userId, startTime)
    })
    .catch((error: unknown) => {
      log.error(
        { storageContextId: item.storageContextId, error: formatError(error) },
        'Handler error during different-user flush',
      )
      emitTurnEnd(item.storageContextId, coalesced, item.contextType, item.userId, startTime, error)
    })
}

// Export types for consumers
export type { QueueItem, CoalescedItem }
export type { ReplyFn } from '../chat/types.js'

// Export registry for testing
export { registry }

/**
 * Clean up expired queues and their associated handlers.
 * Should be called periodically by the scheduler.
 */
export function cleanupExpiredQueues(): void {
  const expired = registry.cleanupExpired()
  if (expired.length > 0) {
    log.debug({ expiredCount: expired.length }, 'Cleaned up expired queue handlers')
  }
}

/**
 * Enqueue a message for processing.
 * Fire-and-forget: resolves immediately after buffering.
 *
 * @param item - The message to enqueue
 * @param reply - Reply function for sending responses
 * @param handler - Callback to process the coalesced message
 */
export function enqueueMessage(
  item: QueueItem,
  reply: ReplyFn,
  handler: (coalesced: CoalescedItem) => Promise<void>,
): void {
  log.debug(
    {
      userId: item.userId,
      storageContextId: item.storageContextId,
      contextType: item.contextType,
    },
    'Enqueuing message',
  )

  const queue = registry.getOrCreate(item.storageContextId)
  queue.setHandler(handler)
  const coalesced = queue.enqueue(item, reply)

  // Handle different-user flush in group main - the returned item needs immediate processing
  if (coalesced !== null) {
    invokeHandlerWithEvents(handler, coalesced, item)
  }
}

/**
 * Race promises against a timeout.
 * Resolves when all promises complete, or rejects if timeout expires first.
 */
function raceWithTimeout<T>(promises: Promise<T>[], timeoutMs: number): Promise<{ completed: boolean }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('Handler timeout'))
    }, timeoutMs)
  })

  const cleanup = (): void => {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }

  return Promise.race([Promise.all(promises).then(() => ({ completed: true })), timeoutPromise])
    .then((result) => {
      cleanup()
      return result
    })
    .catch((error: unknown) => {
      cleanup()
      throw error
    })
}

function flushQueueWithEvents(storageContextId: string, queue: MessageQueue): Promise<void> | null {
  const coalesced = queue.forceFlush()
  if (coalesced === null) return null
  log.debug({ storageContextId, textLength: coalesced.text.length }, 'Flushing queue')
  const handler = queue.getHandler()
  if (handler === null) return null
  emitScoped('queue:dequeue', storageContextId, {
    storageContextId,
    contextType: coalesced.contextType,
    userId: coalesced.userId,
  })
  const handlerStart = Date.now()
  return handler(coalesced)
    .then(() => {
      emitTurnEnd(storageContextId, coalesced, coalesced.contextType, coalesced.userId, handlerStart)
    })
    .catch((error: unknown) => {
      log.error({ storageContextId, error: formatError(error) }, 'Error during shutdown flush')
      emitTurnEnd(storageContextId, coalesced, coalesced.contextType, coalesced.userId, handlerStart, error)
    })
}

/**
 * Flush all active queues on shutdown.
 * Called during graceful shutdown to process pending messages.
 *
 * @param options - Configuration options
 * @param options.timeoutMs - Maximum time to wait (default: 5000ms)
 */
export async function flushOnShutdown(options: { timeoutMs?: number } = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 5000
  const overallStart = Date.now()

  log.info('Starting graceful shutdown flush')

  const queues = registry.getAllQueues()
  const flushPromises: Promise<void>[] = []

  for (const [storageContextId, queue] of queues) {
    const promise = flushQueueWithEvents(storageContextId, queue)
    if (promise !== null) flushPromises.push(promise)

    if (Date.now() - overallStart > timeout) {
      log.warn('Shutdown flush timeout reached, some messages may be lost')
      break
    }
  }

  // Wait for all flushes to complete (with timeout)
  const remainingTimeout = Math.max(0, timeout - (Date.now() - overallStart))
  await raceWithTimeout(flushPromises, remainingTimeout).catch((error: unknown) => {
    log.warn({ error: formatError(error) }, 'Some handlers did not complete within timeout')
  })

  log.info({ queueCount: queues.size }, 'Shutdown flush complete')
}
