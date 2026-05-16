// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { handleAuthEvent, handleConfigEditorEvent, handleIdentityEvent } from './context-handlers.js'
import {
  handleDeferredEvent,
  handleMemoEvent,
  handleNotificationEvent,
  handleRecurringEvent,
  handleToolFailureClassified,
  handleTurnEnd,
  handleTurnStart,
  handleTurnSummary,
} from './handlers-new-events.js'

type EventHandler = (d: Record<string, unknown>) => void

const turnAndNotificationHandlers: Record<string, EventHandler> = {
  'turn:start': (d): void => {
    handleTurnStart(d)
  },
  'turn:end': (d): void => {
    handleTurnEnd(d)
  },
  'turn:summary': (d): void => {
    handleTurnSummary(d)
  },
  'reply:sent': (d): void => {
    handleNotificationEvent('reply:sent', d)
  },
  'typing:start': (d): void => {
    handleNotificationEvent('typing:start', d)
  },
  'typing:stop': (d): void => {
    handleNotificationEvent('typing:stop', d)
  },
  'notify:scheduler_fired': (d): void => {
    handleNotificationEvent('notify:scheduler_fired', d)
  },
  'notify:deferred_alert': (d): void => {
    handleNotificationEvent('notify:deferred_alert', d)
  },
  'tool:failure_classified': (d): void => {
    handleToolFailureClassified(d)
  },
}

const reminderHandlers: Record<string, EventHandler> = {
  'recurring:created': (d): void => {
    handleRecurringEvent('recurring:created', d)
  },
  'recurring:updated': (d): void => {
    handleRecurringEvent('recurring:updated', d)
  },
  'recurring:paused': (d): void => {
    handleRecurringEvent('recurring:paused', d)
  },
  'recurring:resumed': (d): void => {
    handleRecurringEvent('recurring:resumed', d)
  },
  'recurring:deleted': (d): void => {
    handleRecurringEvent('recurring:deleted', d)
  },
  'recurring:fired': (d): void => {
    handleRecurringEvent('recurring:fired', d)
  },
  'deferred:created': (d): void => {
    handleDeferredEvent('deferred:created', d)
  },
  'deferred:updated': (d): void => {
    handleDeferredEvent('deferred:updated', d)
  },
  'deferred:cancelled': (d): void => {
    handleDeferredEvent('deferred:cancelled', d)
  },
  'deferred:fired': (d): void => {
    handleDeferredEvent('deferred:fired', d)
  },
  'deferred:alerted': (d): void => {
    handleDeferredEvent('deferred:alerted', d)
  },
  'memo:created': (d): void => {
    handleMemoEvent('memo:created', d)
  },
  'memo:archived': (d): void => {
    handleMemoEvent('memo:archived', d)
  },
}

const contextHandlers: Record<string, EventHandler> = {
  'identity:set': (d): void => {
    handleIdentityEvent('identity:set', d)
  },
  'identity:cleared': (d): void => {
    handleIdentityEvent('identity:cleared', d)
  },
  'config_editor:opened': (d): void => {
    handleConfigEditorEvent('config_editor:opened', d)
  },
  'config_editor:closed': (d): void => {
    handleConfigEditorEvent('config_editor:closed', d)
  },
  'config_editor:step': (d): void => {
    handleConfigEditorEvent('config_editor:step', d)
  },
  'auth:group_authorized': (d): void => {
    handleAuthEvent('auth:group_authorized', d)
  },
  'auth:group_revoked': (d): void => {
    handleAuthEvent('auth:group_revoked', d)
  },
}

export function buildExtendedHandlers(base: Record<string, EventHandler>): Record<string, EventHandler> {
  return { ...base, ...turnAndNotificationHandlers, ...reminderHandlers, ...contextHandlers }
}
