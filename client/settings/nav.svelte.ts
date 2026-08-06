// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface NavItem {
  id: string
  label: string
}

export type NavGroupKey = 'personal' | 'advanced' | 'admin'

export interface NavGroup {
  key: NavGroupKey
  kicker: string
  items: readonly NavItem[]
  collapsible: boolean
  danger: boolean
}

/** The slice of the session the nav model needs; keeps this module DOM- and store-free. */
export interface NavSession {
  isBotAdmin: boolean
  isSuperAdmin: boolean
}

const PERSONAL_ITEMS: readonly NavItem[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'task-provider', label: 'Task provider' },
  { id: 'tools', label: 'Tools' },
  { id: 'analytics', label: 'Analytics' },
]

const GROUP_ITEMS: readonly NavItem[] = [
  { id: 'members', label: 'Members' },
  { id: 'group-provider', label: 'Group provider' },
  { id: 'guest-mode', label: 'Guest mode' },
  { id: 'coding-identity', label: 'Session identity' },
  { id: 'kaneo-access', label: 'My Kaneo access' },
]

const ADVANCED_ITEMS: readonly NavItem[] = [
  { id: 'memory', label: 'Memory' },
  { id: 'ai-output', label: 'AI output' },
  { id: 'identity', label: 'Identity' },
  { id: 'byok', label: 'BYOK LLM' },
  { id: 'coding-credentials', label: 'Coding sessions' },
  { id: 'coding-mcp', label: 'Coding MCP servers' },
  { id: 'code-host', label: 'Code host' },
  { id: 'repos', label: 'Repositories' },
  { id: 'mcp', label: 'MCP' },
  { id: 'plugins', label: 'Plugins' },
]

// 'Analytics policy' and 'BYOK keys' name what the admin section does rather than
// repeating the personal section's label; the group kicker alone did not tell the
// two apart in the jump menu, where kickers are optgroup labels.
const BOT_ADMIN_ITEMS: readonly NavItem[] = [
  { id: 'instances', label: 'Instances' },
  { id: 'llm-providers', label: 'LLM providers' },
  { id: 'llm-models', label: 'LLM models' },
  { id: 'byok-admin', label: 'BYOK keys' },
  { id: 'plugin-config', label: 'Plugin config' },
  { id: 'users', label: 'Users' },
  { id: 'tool-defaults', label: 'Tool defaults' },
  { id: 'coding-guardrails', label: 'Coding guardrails' },
  { id: 'mcp-catalog', label: 'MCP catalog' },
  { id: 'mcp-plugin-servers', label: 'MCP plugin servers' },
  { id: 'groups', label: 'Groups' },
  { id: 'announce', label: 'Announce' },
  { id: 'release-notes', label: 'Release notes' },
  { id: 'analytics-admin', label: 'Analytics policy' },
]

const SUPER_ADMIN_ITEMS: readonly NavItem[] = [
  { id: 'admins', label: 'Admins' },
  { id: 'plugin-approval', label: 'Plugin approval' },
]

const NAV_GROUP_KEYS: readonly string[] = ['personal', 'advanced', 'admin']

export function isNavGroupKey(value: string): value is NavGroupKey {
  return NAV_GROUP_KEYS.includes(value)
}

export function buildNavGroups(session: NavSession, isGroup: boolean): NavGroup[] {
  const groups: NavGroup[] = [
    {
      key: 'personal',
      kicker: 'Personal',
      collapsible: false,
      danger: false,
      items: isGroup ? [...PERSONAL_ITEMS, ...GROUP_ITEMS] : [...PERSONAL_ITEMS],
    },
    { key: 'advanced', kicker: 'Advanced', collapsible: true, danger: false, items: ADVANCED_ITEMS },
  ]

  const adminItems: NavItem[] = []
  if (session.isBotAdmin) adminItems.push(...BOT_ADMIN_ITEMS)
  // Super admins are always bot admins, so adminItems already holds the bot-admin entries.
  if (session.isSuperAdmin) adminItems.push(...SUPER_ADMIN_ITEMS)
  if (adminItems.length > 0) {
    groups.push({ key: 'admin', kicker: 'Admin', collapsible: true, danger: true, items: adminItems })
  }

  return groups
}

const DEFAULT_COLLAPSE: Record<NavGroupKey, boolean> = {
  personal: false,
  // Both collapsible groups start closed: Advanced holds ten optional integrations,
  // Admin holds sixteen sections that each fetch on mount.
  advanced: true,
  admin: true,
}

const collapse = $state<Record<NavGroupKey, boolean>>({ ...DEFAULT_COLLAPSE })

export function isGroupCollapsed(key: NavGroupKey): boolean {
  return collapse[key]
}

export function toggleGroup(key: NavGroupKey): void {
  collapse[key] = !collapse[key]
}

export function resetNavCollapse(): void {
  for (const key of NAV_GROUP_KEYS) {
    if (isNavGroupKey(key)) collapse[key] = DEFAULT_COLLAPSE[key]
  }
}

/**
 * Opens whichever collapsible group owns `id`, so a deep link, a sidebar click, or a
 * jump-menu pick lands on a mounted section. Reports whether it changed anything.
 */
export function expandGroupOwning(id: string, groups: readonly NavGroup[]): boolean {
  const owner = groups.find((group) => group.items.some((item) => item.id === id))
  if (owner === undefined || !owner.collapsible || !collapse[owner.key]) return false
  collapse[owner.key] = false
  return true
}

export function allSectionIds(groups: readonly NavGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.id))
}

/** Only the sections currently on the page: a collapsed group's sections are unmounted. */
export function mountedSectionIds(groups: readonly NavGroup[]): string[] {
  return groups.filter((group) => !collapse[group.key]).flatMap((group) => group.items.map((item) => item.id))
}

/** A group's own summary line, derived from its items so it cannot drift from them. */
export function groupHint(items: readonly NavItem[]): string {
  if (items.length === 0) return ''
  const shown = items.slice(0, 3).map((item) => item.label)
  const rest = items.length - shown.length
  return rest > 0 ? `${shown.join(', ')} + ${rest} more` : shown.join(', ')
}
