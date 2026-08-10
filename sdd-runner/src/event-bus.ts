// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EventInput } from './events.js'

export type EventSubscriber = (event: EventInput) => void

export interface EventBus {
  readonly emit: (event: EventInput) => void
  readonly subscribe: (subscriber: EventSubscriber) => () => void
}

export interface EventBusOptions {
  readonly onError?: (error: Error, event: EventInput) => void
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const subscribers: EventSubscriber[] = []
  return {
    emit: (event) => {
      for (const subscriber of subscribers) {
        try {
          subscriber(event)
        } catch (error) {
          options.onError?.(error instanceof Error ? error : new Error(String(error)), event)
        }
      }
    },
    subscribe: (subscriber) => {
      subscribers.push(subscriber)
      return () => {
        const index = subscribers.indexOf(subscriber)
        if (index !== -1) subscribers.splice(index, 1)
      }
    },
  }
}
