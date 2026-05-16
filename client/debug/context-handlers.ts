// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import type { AuthorizedGroupEntry } from './dashboard-types.js'
import { state } from './state.js'

let contextRenderPending = false

export function scheduleContextRender(): void {
  if (!contextRenderPending) {
    contextRenderPending = true
    requestAnimationFrame(() => {
      contextRenderPending = false
      window.dashboard.renderContext()
    })
  }
}

export function handleIdentityEvent(type: string, d: Record<string, unknown>): void {
  const userId = typeof d['userId'] === 'string' ? d['userId'] : ''
  if (userId === '') return

  if (type === 'identity:set') {
    state.identityMappings.set(userId, {
      userId,
      provider: typeof d['provider'] === 'string' ? d['provider'] : '',
      providerUserId: typeof d['providerUserId'] === 'string' ? d['providerUserId'] : null,
      providerUserLogin: typeof d['providerUserLogin'] === 'string' ? d['providerUserLogin'] : null,
      displayName: typeof d['displayName'] === 'string' ? d['displayName'] : null,
    })
  } else if (type === 'identity:cleared') {
    state.identityMappings.delete(userId)
  }
  scheduleContextRender()
}

export function handleConfigEditorEvent(type: string, d: Record<string, unknown>): void {
  const userId = typeof d['userId'] === 'string' ? d['userId'] : ''
  if (userId === '') return

  if (type === 'config_editor:opened') {
    state.activeConfigEditors.add(userId)
  } else if (type === 'config_editor:closed') {
    state.activeConfigEditors.delete(userId)
  }
  scheduleContextRender()
}

export function handleAuthEvent(type: string, d: Record<string, unknown>): void {
  const groupId = typeof d['groupId'] === 'string' ? d['groupId'] : ''
  if (groupId === '') return

  if (type === 'auth:group_authorized') {
    const exists = state.authorizedGroups.some((g: AuthorizedGroupEntry) => g.group_id === groupId)
    if (!exists) {
      state.authorizedGroups.unshift({
        group_id: groupId,
        added_by: '',
        added_at: new Date().toISOString(),
      })
    }
  } else if (type === 'auth:group_revoked') {
    state.authorizedGroups = state.authorizedGroups.filter((g: AuthorizedGroupEntry) => g.group_id !== groupId)
  }
  scheduleContextRender()
}
