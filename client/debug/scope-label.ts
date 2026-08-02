// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Turn } from './dashboard-types.js'

/** Compact scope label shared by the turns table and the detail views. */
export function formatScope(scope: Turn['scope']): string {
  const { kind, userId, groupId, threadId } = scope
  if (kind === 'user') return userId !== undefined && userId !== '' ? `dm:${userId}` : 'dm'
  if (kind === 'group') {
    const base = groupId !== undefined && groupId !== '' ? `group:${groupId}` : 'group'
    return threadId !== undefined && threadId !== '' ? `${base}/${threadId}` : base
  }
  return 'global'
}
