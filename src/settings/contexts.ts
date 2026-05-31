// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SettingsPrincipal } from './principal.js'

export type AvailableContext = {
  readonly kind: 'personal' | 'group'
  readonly contextId: string
  readonly label: string
}

export function listAvailableContexts(principal: SettingsPrincipal): readonly AvailableContext[] {
  const groups: AvailableContext[] = principal.manageableGroups.map((g) => ({
    kind: 'group',
    contextId: g.contextId,
    label: g.displayName,
  }))

  if (!principal.authorized) return groups

  const personal: AvailableContext = {
    kind: 'personal',
    contextId: principal.personalConfigContextId,
    label: 'Personal',
  }
  return [personal, ...groups]
}
