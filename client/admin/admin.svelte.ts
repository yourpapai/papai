// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { adminGlobals, refreshGlobals } from './global-stats.svelte.js'
import type { StatsWindow } from './global-stats.svelte.js'

export const adminSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'billing', label: 'Billing' },
  { id: 'stats', label: 'Stats' },
  { id: 'memos', label: 'Memos' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'identities', label: 'Identities' },
  { id: 'groups', label: 'Groups' },
  { id: 'instances', label: 'Instances' },
  { id: 'plugin-config', label: 'Plugin Config' },
  { id: 'system', label: 'System' },
] as const

export type AdminSectionId = (typeof adminSections)[number]['id']

export interface AdminSection {
  readonly id: AdminSectionId
  readonly label: string
}

const sectionIds: ReadonlySet<string> = new Set(adminSections.map((section) => section.id))

function isAdminSectionId(value: string): value is AdminSectionId {
  return sectionIds.has(value)
}

export function sectionFromHash(hash: string): AdminSectionId {
  const normalized = hash.replace(/^#/u, '').toLowerCase()
  return isAdminSectionId(normalized) ? normalized : 'overview'
}

export function sectionLabel(sectionId: AdminSectionId): string {
  const section = adminSections.find((candidate) => candidate.id === sectionId)
  if (section === undefined) return 'Overview'
  return section.label
}

export const adminState = $state({
  currentSection: sectionFromHash(typeof location === 'undefined' ? '' : location.hash),
  lastRefreshedAt: null as number | null,
})

export function setSection(id: AdminSectionId): void {
  adminState.currentSection = id
}

export function setWindow(next: StatsWindow): void {
  adminGlobals.window = next
  void refreshGlobals()
}

export async function refreshAll(): Promise<void> {
  await refreshGlobals()
  adminState.lastRefreshedAt = Date.now()
}

export function syncSectionFromLocation(): void {
  adminState.currentSection = sectionFromHash(location.hash)
}
