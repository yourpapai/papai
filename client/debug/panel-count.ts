// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ScopeFilter } from './dashboard-types.js'

/**
 * Panel header count that stays honest under the top-bar scope filter:
 * bare total when unfiltered, `filtered/total` when a dm/group filter hides rows.
 */
export function panelCount(filtered: number, total: number, scopeFilter: ScopeFilter): string {
  return scopeFilter === 'all' ? String(total) : `${filtered}/${total}`
}
