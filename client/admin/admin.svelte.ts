// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const adminSections = [
  { id: 'system', label: 'System' },
  { id: 'billing', label: 'Billing' },
  { id: 'memos', label: 'Memos' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'identities', label: 'Identities' },
  { id: 'groups', label: 'Groups' },
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
  return isAdminSectionId(normalized) ? normalized : 'system'
}

export function sectionLabel(sectionId: AdminSectionId): string {
  const section = adminSections.find((candidate) => candidate.id === sectionId)
  if (section === undefined) return 'System'
  return section.label
}

export const adminState = $state({
  currentSection: sectionFromHash(typeof location === 'undefined' ? '' : location.hash),
})

export function syncSectionFromLocation(): void {
  adminState.currentSection = sectionFromHash(location.hash)
}
