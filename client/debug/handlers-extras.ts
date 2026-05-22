// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DashboardState } from './dashboard-types.js'
import { pickString } from './handlers-helpers.js'

export function handleConfigEditorEvent(state: DashboardState, type: string, d: Record<string, unknown>): void {
  const userId = pickString(d, 'userId')
  if (userId === '') return
  if (type === 'config_editor:opened') state.activeConfigEditors.add(userId)
  else if (type === 'config_editor:closed') state.activeConfigEditors.delete(userId)
}
