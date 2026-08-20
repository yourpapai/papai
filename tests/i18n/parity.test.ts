// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../src/i18n/locales/en.js'
import { ru } from '../../src/i18n/locales/ru.js'
import type { Dictionary } from '../../src/i18n/types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collect every dotted key path whose leaf is a string. */
function keyPaths(node: unknown, prefix = ''): string[] {
  if (!isRecord(node)) return []
  const paths: string[] = []
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') paths.push(path)
    else paths.push(...keyPaths(value, path))
  }
  return paths
}

/** Resolve a dotted key path to its leaf value. */
function leafAt(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => (isRecord(node) ? node[segment] : undefined), catalog)
}

const isNonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length > 0

/** Resolve a nested subtree, or `{}` when the catalog does not declare it (yet). */
const subtreeOf = (node: unknown, key: string): Record<string, unknown> => {
  const value = isRecord(node) ? node[key] : undefined
  return isRecord(value) ? value : {}
}

/** Coerce a leaf to its string form, or `''` when it is not a string. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Every tool name the live-status REGISTRY covers; each needs a `liveStatus.tools.<name>` entry. */
const LIVE_STATUS_TOOL_KEYS = [
  'add_comment',
  'cancel_reminder',
  'count_tasks',
  'create_alert',
  'create_project',
  'create_recurring_task',
  'create_reminder',
  'create_task',
  'delete_task',
  'fetch_chat_link',
  'find_user',
  'get_current_time',
  'get_reminder',
  'get_task',
  'list_files',
  'list_memos',
  'list_memory',
  'list_projects',
  'list_reminders',
  'list_tasks',
  'lookup_group_history',
  'remember_memory',
  'resolve_staged_file',
  'save_memo',
  'search_memos',
  'search_memory',
  'search_staged_files',
  'search_tasks',
  'update_reminder',
  'update_task',
  'upload_attachment',
  'web_fetch',
] as const

/** Stable section ids the context collector emits; each needs a `contextView.sections.<id>` entry. */
const CONTEXT_SECTION_IDS = [
  'system_prompt',
  'base_instructions',
  'custom_instructions',
  'provider_addendum',
  'memory_context',
  'summary',
  'known_entities',
  'conversation_history',
  'tools',
] as const

const CONTEXT_COUNT_KEYS = ['factSingular', 'factPlural', 'messageSingular', 'messagePlural'] as const

const CONTEXT_CHROME_KEYS = [
  'headerWord',
  'tokensUnit',
  'tokenSuffix',
  'approximateMarker',
  'approximateFooter',
] as const

const requireLiveStatusSubtree = (catalog: unknown): void => {
  const liveStatus = subtreeOf(catalog, 'liveStatus')
  expect(isNonEmptyString(liveStatus['thinking'])).toBe(true)
  expect(isNonEmptyString(liveStatus['preparingResponse'])).toBe(true)
  expect(textOf(liveStatus['runningTool'])).toContain('{tool}')
  const tools = subtreeOf(liveStatus, 'tools')
  expect(Object.keys(tools).sort()).toEqual([...LIVE_STATUS_TOOL_KEYS].sort())
  for (const key of LIVE_STATUS_TOOL_KEYS) {
    expect(isNonEmptyString(tools[key])).toBe(true)
  }
}

const requireContextViewSubtree = (catalog: unknown): void => {
  const contextView = subtreeOf(catalog, 'contextView')
  const sections = subtreeOf(contextView, 'sections')
  expect(Object.keys(sections).sort()).toEqual([...CONTEXT_SECTION_IDS].sort())
  for (const id of CONTEXT_SECTION_IDS) {
    expect(isNonEmptyString(sections[id])).toBe(true)
  }
  for (const key of CONTEXT_COUNT_KEYS) {
    expect(textOf(contextView[key])).toContain('{count}')
  }
  const progressive = textOf(contextView['progressiveDisclosure'])
  expect(progressive).toContain('{active}')
  expect(progressive).toContain('{available}')
  for (const key of CONTEXT_CHROME_KEYS) {
    expect(isNonEmptyString(contextView[key])).toBe(true)
  }
}

describe('locale key parity', () => {
  test('every en key path exists in ru', () => {
    const enKeys = keyPaths(en)
    expect(enKeys.length).toBeGreaterThan(0)
    const ruKeys = new Set(keyPaths(ru))
    const missing = enKeys.filter((key) => !ruKeys.has(key))
    expect(missing).toEqual([])
  })

  test('ru declares no extra keys unknown to en', () => {
    const enKeys = new Set(keyPaths(en))
    const extra = keyPaths(ru).filter((key) => !enKeys.has(key))
    expect(extra).toEqual([])
  })

  test('every ru leaf is a non-empty string', () => {
    const catalog: Dictionary = ru
    const leaves = keyPaths(catalog)
    expect(leaves.length).toBe(keyPaths(en).length)
    for (const path of leaves) {
      expect(isNonEmptyString(leafAt(catalog, path))).toBe(true)
    }
  })
})

describe('required subtrees', () => {
  test('en declares the liveStatus subtree: status texts plus one label per REGISTRY tool', () => {
    requireLiveStatusSubtree(en)
  })

  test('ru declares the liveStatus subtree: status texts plus one label per REGISTRY tool', () => {
    requireLiveStatusSubtree(ru)
  })

  test('en declares the contextView subtree: sections, counts, progressive disclosure, chrome', () => {
    requireContextViewSubtree(en)
  })

  test('ru declares the contextView subtree: sections, counts, progressive disclosure, chrome', () => {
    requireContextViewSubtree(ru)
  })
})
