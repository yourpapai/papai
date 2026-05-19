// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DashboardState } from './dashboard-types.js'
import { CAPS, pickString, pickStringOrNull } from './handlers-helpers.js'

export function handleRecurringEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  const taskId = pickString(d, 'taskId')
  if (taskId === '') return

  if (type === 'recurring:created') {
    state.recurringTasks.unshift({
      id: taskId,
      userId: pickString(d, 'userId'),
      title: pickString(d, 'title') || 'Untitled',
      rrule: pickStringOrNull(d, 'rrule'),
      nextRun: pickStringOrNull(d, 'nextRun'),
      enabled: true,
      lastRun: null,
    })
    if (state.recurringTasks.length > CAPS.RECURRING) state.recurringTasks.pop()
    return
  }

  if (type === 'recurring:deleted') {
    state.recurringTasks = state.recurringTasks.filter((t) => t.id !== taskId)
    return
  }

  const existing = state.recurringTasks.find((t) => t.id === taskId)
  if (existing === undefined) return
  if (type === 'recurring:updated') {
    if (typeof d['title'] === 'string') existing.title = d['title']
    if (typeof d['rrule'] === 'string') existing.rrule = d['rrule']
    if (typeof d['nextRun'] === 'string') existing.nextRun = d['nextRun']
  } else if (type === 'recurring:paused') existing.enabled = false
  else if (type === 'recurring:resumed') existing.enabled = true
}

export function handleDeferredEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  const promptId = pickString(d, 'promptId')
  if (promptId === '') return

  if (type === 'deferred:created') {
    state.deferredPrompts.unshift({
      id: promptId,
      createdByUserId: pickString(d, 'userId'),
      prompt: pickString(d, 'prompt'),
      fireAt: pickString(d, 'fireAt') || new Date().toISOString(),
      rrule: pickStringOrNull(d, 'rrule'),
      status: 'active',
    })
    if (state.deferredPrompts.length > CAPS.DEFERRED) state.deferredPrompts.pop()
    return
  }

  if (type === 'deferred:cancelled') {
    state.deferredPrompts = state.deferredPrompts.filter((p) => p.id !== promptId)
    return
  }

  const existing = state.deferredPrompts.find((p) => p.id === promptId)
  if (existing === undefined) return
  if (type === 'deferred:updated') {
    if (typeof d['prompt'] === 'string') existing.prompt = d['prompt']
    if (typeof d['fireAt'] === 'string') existing.fireAt = d['fireAt']
  } else if (type === 'deferred:fired') existing.status = 'completed'
}

export function handleMemoEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  if (type === 'memo:created') {
    const memoId = pickString(d, 'memoId')
    if (memoId === '') return
    const now = new Date().toISOString()
    state.memos.unshift({
      id: memoId,
      userId: pickString(d, 'userId'),
      content: pickString(d, 'content'),
      summary: null,
      tags: Array.isArray(d['tags']) ? d['tags'].filter((t): t is string => typeof t === 'string') : [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    if (state.memos.length > CAPS.MEMO) state.memos.pop()
    return
  }

  if (type === 'memo:archived') {
    const memoIds = Array.isArray(d['memoIds']) ? d['memoIds'].filter((id): id is string => typeof id === 'string') : []
    for (const id of memoIds) {
      const existing = state.memos.find((m) => m.id === id)
      if (existing !== undefined) existing.status = 'archived'
    }
  }
}

export function handleIdentityEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  const userId = pickString(d, 'userId')
  if (userId === '') return

  if (type === 'identity:set') {
    state.identityMappings.set(userId, {
      userId,
      provider: pickString(d, 'provider'),
      providerUserId: pickStringOrNull(d, 'providerUserId'),
      providerUserLogin: pickStringOrNull(d, 'providerUserLogin'),
      displayName: pickStringOrNull(d, 'displayName'),
    })
  } else if (type === 'identity:cleared') {
    state.identityMappings.delete(userId)
  }
}

export function handleConfigEditorEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  const userId = pickString(d, 'userId')
  if (userId === '') return
  if (type === 'config_editor:opened') state.activeConfigEditors.add(userId)
  else if (type === 'config_editor:closed') state.activeConfigEditors.delete(userId)
}

export function handleAuthEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  const groupId = pickString(d, 'groupId')
  if (groupId === '') return

  if (type === 'auth:group_authorized') {
    const exists = state.authorizedGroups.some((g) => g.group_id === groupId)
    if (!exists) {
      state.authorizedGroups.unshift({ group_id: groupId, added_by: '', added_at: new Date().toISOString() })
    }
  } else if (type === 'auth:group_revoked') {
    state.authorizedGroups = state.authorizedGroups.filter((g) => g.group_id !== groupId)
  }
}
