// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { MessageQueue } from './queue.js'

const log = logger.child({ scope: 'message-queue:registry' })
// 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000

export class QueueRegistry {
  private queues = new Map<string, MessageQueue>()
  private lastAccessed = new Map<string, number>()

  getOrCreate(storageContextId: string): MessageQueue {
    let queue = this.queues.get(storageContextId)
    if (queue === undefined) {
      log.debug({ storageContextId }, 'Creating new queue')
      queue = new MessageQueue(storageContextId)
      this.queues.set(storageContextId, queue)
    }
    this.lastAccessed.set(storageContextId, Date.now())
    return queue
  }

  get(storageContextId: string): MessageQueue | undefined {
    const queue = this.queues.get(storageContextId)
    if (queue !== undefined) {
      this.lastAccessed.set(storageContextId, Date.now())
    }
    return queue
  }

  cleanupExpired(): string[] {
    const now = Date.now()
    const expired: string[] = []
    for (const [id, lastAccess] of this.lastAccessed) {
      if (now - lastAccess > SESSION_TTL_MS) {
        expired.push(id)
      }
    }
    for (const id of expired) {
      log.debug({ storageContextId: id }, 'Cleaning up expired queue')
      this.queues.delete(id)
      this.lastAccessed.delete(id)
    }
    if (expired.length > 0) {
      log.info({ expiredCount: expired.length }, 'Cleaned up expired queues')
    }
    return expired
  }

  getAllQueues(): Map<string, MessageQueue> {
    return new Map(this.queues)
  }
}
