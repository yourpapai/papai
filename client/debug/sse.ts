// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  parseStateInitEvent,
  parseStateStatsEvent,
  parseLlmTrace,
  parseCacheEvent,
  parseUserIdEvent,
  parseWizard,
  parseSchedulerTickEvent,
  parsePollerEvent,
  parseMessageCacheEvent,
  parseLogEntry,
} from '../../src/debug/schemas.js'
import type { DashboardState } from './dashboard-types.js'
import {
  handleAuthEvent,
  handleConfigEditorEvent,
  handleDeferredEvent,
  handleIdentityEvent,
  handleMemoEvent,
  handleRecurringEvent,
} from './handlers-extras.js'
import {
  handleCacheEvent,
  handleCacheExpire,
  handleLlmFull,
  handleLogEntry,
  handleMsgcacheSweep,
  handleNotificationEvent,
  handlePollerEvent,
  handleSchedulerTick,
  handleStateInit,
  handleStateStats,
  handleToolFailureClassified,
  handleTurnEnd,
  handleTurnStart,
  handleTurnSummary,
  handleWizardCreated,
  handleWizardDeleted,
  handleWizardUpdated,
} from './handlers.js'

export type EventHandler = (d: Record<string, unknown>) => void

function safe<T>(parser: (d: unknown) => T, run: (parsed: T) => void): EventHandler {
  return (d) => {
    try {
      run(parser(d))
    } catch {
      // Skip malformed events
    }
  }
}

function coreHandlers(state: DashboardState): Record<string, EventHandler> {
  return {
    'state:init': safe(parseStateInitEvent, (d) => {
      handleStateInit(state, d)
    }),
    'state:stats': safe(parseStateStatsEvent, (d) => {
      handleStateStats(state, d)
    }),
    'llm:full': safe(parseLlmTrace, (d) => {
      handleLlmFull(state, d)
    }),
    'cache:load': safe(parseCacheEvent, (d) => {
      handleCacheEvent(state, d)
    }),
    'cache:sync': safe(parseCacheEvent, (d) => {
      handleCacheEvent(state, d)
    }),
    'cache:expire': safe(parseUserIdEvent, (d) => {
      handleCacheExpire(state, d)
    }),
    'wizard:created': safe(parseWizard, (d) => {
      handleWizardCreated(state, d)
    }),
    'wizard:updated': safe(parseWizard, (d) => {
      handleWizardUpdated(state, d)
    }),
    'wizard:deleted': safe(parseUserIdEvent, (d) => {
      handleWizardDeleted(state, d)
    }),
    'scheduler:tick': safe(parseSchedulerTickEvent, (d) => {
      handleSchedulerTick(state, d)
    }),
    'poller:scheduled': safe(parsePollerEvent, (d) => {
      handlePollerEvent(state, d)
    }),
    'poller:alerts': safe(parsePollerEvent, (d) => {
      handlePollerEvent(state, d)
    }),
    'msgcache:sweep': safe(parseMessageCacheEvent, (d) => {
      handleMsgcacheSweep(state, d)
    }),
    'log:entry': safe(parseLogEntry, (d) => {
      handleLogEntry(state, d)
    }),
  }
}

function turnHandlers(state: DashboardState): Record<string, EventHandler> {
  const notify =
    (type: string): EventHandler =>
    (d) => {
      handleNotificationEvent(state, type, d)
    }
  return {
    'turn:start': (d) => {
      handleTurnStart(state, d)
    },
    'turn:end': (d) => {
      handleTurnEnd(state, d)
    },
    'turn:summary': (d) => {
      handleTurnSummary(state, d)
    },
    'tool:failure_classified': (d) => {
      handleToolFailureClassified(state, d)
    },
    'reply:sent': notify('reply:sent'),
    'typing:start': notify('typing:start'),
    'typing:stop': notify('typing:stop'),
    'notify:scheduler_fired': notify('notify:scheduler_fired'),
    'notify:deferred_alert': notify('notify:deferred_alert'),
  }
}

function recurringHandlers(state: DashboardState): Record<string, EventHandler> {
  const recur =
    (subtype: string): EventHandler =>
    (d) => {
      handleRecurringEvent(state, subtype, d)
    }
  const defer =
    (subtype: string): EventHandler =>
    (d) => {
      handleDeferredEvent(state, subtype, d)
    }
  return {
    'recurring:created': recur('recurring:created'),
    'recurring:updated': recur('recurring:updated'),
    'recurring:paused': recur('recurring:paused'),
    'recurring:resumed': recur('recurring:resumed'),
    'recurring:deleted': recur('recurring:deleted'),
    'recurring:fired': recur('recurring:fired'),
    'deferred:created': defer('deferred:created'),
    'deferred:updated': defer('deferred:updated'),
    'deferred:cancelled': defer('deferred:cancelled'),
    'deferred:fired': defer('deferred:fired'),
    'deferred:alerted': defer('deferred:alerted'),
  }
}

function contextHandlers(state: DashboardState): Record<string, EventHandler> {
  const editor =
    (subtype: string): EventHandler =>
    (d) => {
      handleConfigEditorEvent(state, subtype, d)
    }
  return {
    'memo:created': (d) => {
      handleMemoEvent(state, 'memo:created', d)
    },
    'memo:archived': (d) => {
      handleMemoEvent(state, 'memo:archived', d)
    },
    'identity:set': (d) => {
      handleIdentityEvent(state, 'identity:set', d)
    },
    'identity:cleared': (d) => {
      handleIdentityEvent(state, 'identity:cleared', d)
    },
    'config_editor:opened': editor('config_editor:opened'),
    'config_editor:closed': editor('config_editor:closed'),
    'config_editor:step': editor('config_editor:step'),
    'auth:group_authorized': (d) => {
      handleAuthEvent(state, 'auth:group_authorized', d)
    },
    'auth:group_revoked': (d) => {
      handleAuthEvent(state, 'auth:group_revoked', d)
    },
  }
}

export function buildHandlerMap(state: DashboardState): Record<string, EventHandler> {
  return { ...coreHandlers(state), ...turnHandlers(state), ...recurringHandlers(state), ...contextHandlers(state) }
}

export interface SseConnection {
  readonly source: EventSource
  close(): void
}

export function setupEventSource(
  state: DashboardState,
  onConnectionChange: (connected: boolean) => void,
  handlers: Record<string, EventHandler> = buildHandlerMap(state),
): SseConnection {
  const source = new EventSource('/events')

  source.addEventListener('open', () => {
    onConnectionChange(true)
  })

  source.addEventListener('error', () => {
    onConnectionChange(false)
  })

  for (const [type, handler] of Object.entries(handlers)) {
    source.addEventListener(type, (event) => {
      const data = getMessageEventData(event)
      if (data === undefined) return
      try {
        const parsed: unknown = JSON.parse(data)
        const eventData = unwrapEnvelope(parsed)
        if (eventData !== null) handler(eventData)
      } catch {
        // Skip malformed events
      }
    })
  }

  return {
    source,
    close: () => {
      source.close()
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrapEnvelope(parsed: unknown): Record<string, unknown> | null {
  if (!isRecord(parsed)) return null
  const inner = parsed['data']
  if (isRecord(inner)) return inner
  return parsed
}

function getMessageEventData(event: Event): string | undefined {
  const candidate = event as unknown
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    'data' in candidate &&
    typeof candidate['data'] === 'string'
  ) {
    return candidate['data']
  }
  return undefined
}
