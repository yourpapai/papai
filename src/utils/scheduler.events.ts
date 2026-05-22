// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Scheduler event handling utilities.
 */

import { logger } from '../logger.js'
import type { Emitters, EventEmitter } from './scheduler.helpers.js'
import type { ErrorEvent, FatalErrorEvent, RetryEvent, TickEvent } from './scheduler.types.js'

const log = logger.child({ scope: 'scheduler:events' })

/**
 * Emit tick event to all handlers.
 */
const emitTickEvent = (events: EventEmitter, event: TickEvent): void => {
  events.tick.forEach((handler) => {
    try {
      handler(event)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ error: msg, event: 'tick' }, 'Event handler threw error')
    }
  })
}

/**
 * Emit error event to all handlers.
 */
const emitErrorEvent = (events: EventEmitter, event: ErrorEvent): void => {
  events.error.forEach((handler) => {
    try {
      handler(event)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ error: msg, event: 'error' }, 'Event handler threw error')
    }
  })
}

/**
 * Emit retry event to all handlers.
 */
const emitRetryEvent = (events: EventEmitter, event: RetryEvent): void => {
  events.retry.forEach((handler) => {
    try {
      handler(event)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ error: msg, event: 'retry' }, 'Event handler threw error')
    }
  })
}

/**
 * Emit fatal error event to all handlers.
 */
const emitFatalErrorEvent = (events: EventEmitter, event: FatalErrorEvent): void => {
  events.fatalError.forEach((handler) => {
    try {
      handler(event)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ error: msg, event: 'fatalError' }, 'Event handler threw error')
    }
  })
}

/**
 * Create event emitters.
 */
export const createEmitters = (events: EventEmitter): Emitters => {
  const emitTick = (event: TickEvent): void => {
    emitTickEvent(events, event)
  }
  const emitError = (event: ErrorEvent): void => {
    emitErrorEvent(events, event)
  }
  const emitRetry = (event: RetryEvent): void => {
    emitRetryEvent(events, event)
  }
  const emitFatalError = (event: FatalErrorEvent): void => {
    emitFatalErrorEvent(events, event)
  }

  const emitters: Emitters = {
    emitTick,
    emitError,
    emitRetry,
    emitFatalError,
  }
  return emitters
}
