// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { t } from '../i18n/index.js'
import type { DictionaryKey, Locale } from '../i18n/index.js'

/** Dictionary key of a live-status tool label. */
type LiveStatusToolKey = Extract<DictionaryKey, `liveStatus.tools.${string}`>

/**
 * A status entry for a tool. The optional `arg` extractor is the allowlist: only the
 * single field it reads is ever surfaced. `quote: false` renders the value bare
 * (used for hosts); otherwise it is wrapped in quotes. The label itself is resolved
 * from the i18n catalog via `key`.
 */
type ToolStatusEntry = {
  emoji: string
  key: LiveStatusToolKey
  quote?: boolean
  arg?: (input: unknown) => string | undefined
}

const MAX_ARG_LENGTH = 40

const asRecord = (input: unknown): Record<string, unknown> | undefined => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  return Object.fromEntries(Object.entries(input))
}

/** Return the first non-empty string field among `keys`, or undefined. */
const getStringField = (input: unknown, keys: readonly string[]): string | undefined => {
  const record = asRecord(input)
  if (record === undefined) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/** Extract the host of a `url` field; fall back to the raw value when it does not parse. */
const hostOf = (input: unknown): string | undefined => {
  const url = getStringField(input, ['url'])
  if (url === undefined) return undefined
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Collapse whitespace, trim, and truncate to MAX_ARG_LENGTH with an ellipsis. */
const sanitizeArg = (value: string): string => {
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  return collapsed.length > MAX_ARG_LENGTH ? `${collapsed.slice(0, MAX_ARG_LENGTH)}…` : collapsed
}

const REGISTRY: Record<string, ToolStatusEntry> = {
  web_fetch: { emoji: '🌐', key: 'liveStatus.tools.web_fetch', quote: false, arg: hostOf },
  fetch_chat_link: { emoji: '🔗', key: 'liveStatus.tools.fetch_chat_link', quote: false, arg: hostOf },
  search_memory: { emoji: '🔍', key: 'liveStatus.tools.search_memory', arg: (i) => getStringField(i, ['query']) },
  list_memory: { emoji: '🧠', key: 'liveStatus.tools.list_memory' },
  remember_memory: { emoji: '🧠', key: 'liveStatus.tools.remember_memory' },
  search_memos: { emoji: '🔍', key: 'liveStatus.tools.search_memos', arg: (i) => getStringField(i, ['query']) },
  save_memo: { emoji: '📌', key: 'liveStatus.tools.save_memo' },
  list_memos: { emoji: '📒', key: 'liveStatus.tools.list_memos' },
  create_task: {
    emoji: '📝',
    key: 'liveStatus.tools.create_task',
    arg: (i) => getStringField(i, ['title', 'name']),
  },
  update_task: { emoji: '✏️', key: 'liveStatus.tools.update_task' },
  delete_task: { emoji: '🗑️', key: 'liveStatus.tools.delete_task' },
  get_task: { emoji: '📄', key: 'liveStatus.tools.get_task' },
  list_tasks: { emoji: '📋', key: 'liveStatus.tools.list_tasks' },
  search_tasks: {
    emoji: '🔍',
    key: 'liveStatus.tools.search_tasks',
    arg: (i) => getStringField(i, ['query', 'text']),
  },
  count_tasks: { emoji: '🔢', key: 'liveStatus.tools.count_tasks' },
  add_comment: { emoji: '💬', key: 'liveStatus.tools.add_comment' },
  create_project: {
    emoji: '📁',
    key: 'liveStatus.tools.create_project',
    arg: (i) => getStringField(i, ['name', 'title']),
  },
  list_projects: { emoji: '📁', key: 'liveStatus.tools.list_projects' },
  list_files: { emoji: '📎', key: 'liveStatus.tools.list_files' },
  search_staged_files: {
    emoji: '📎',
    key: 'liveStatus.tools.search_staged_files',
    arg: (i) => getStringField(i, ['query']),
  },
  upload_attachment: { emoji: '📤', key: 'liveStatus.tools.upload_attachment' },
  resolve_staged_file: { emoji: '📎', key: 'liveStatus.tools.resolve_staged_file' },
  create_recurring_task: { emoji: '🔁', key: 'liveStatus.tools.create_recurring_task' },
  create_reminder: {
    emoji: '⏰',
    key: 'liveStatus.tools.create_reminder',
    arg: (i) => getStringField(i, ['prompt']),
  },
  create_alert: { emoji: '🔔', key: 'liveStatus.tools.create_alert', arg: (i) => getStringField(i, ['prompt']) },
  list_reminders: { emoji: '📋', key: 'liveStatus.tools.list_reminders' },
  get_reminder: { emoji: '📄', key: 'liveStatus.tools.get_reminder' },
  update_reminder: { emoji: '✏️', key: 'liveStatus.tools.update_reminder' },
  cancel_reminder: { emoji: '🗑️', key: 'liveStatus.tools.cancel_reminder' },
  lookup_group_history: { emoji: '🕘', key: 'liveStatus.tools.lookup_group_history' },
  find_user: { emoji: '👤', key: 'liveStatus.tools.find_user' },
  get_current_time: { emoji: '🕒', key: 'liveStatus.tools.get_current_time' },
}

/** Humanize a tool id for the fallback: last `__` segment (MCP/plugin) or stripped prefix, spaced + lowercased. */
const humanizeToolName = (toolName: string): string => {
  const base = toolName.includes('__')
    ? toolName.slice(toolName.lastIndexOf('__') + 2)
    : toolName.replace(/^(?:mcp|plugin)_/u, '')
  return base.replace(/[_-]+/gu, ' ').trim().toLowerCase()
}

/** Render the status line for a tool call (without the parallel "(+n)" suffix, which the reporter adds). */
export const formatToolStatus = (toolName: string, input: unknown, locale: Locale = 'en'): string => {
  const entry = REGISTRY[toolName]
  if (entry === undefined) {
    return t('liveStatus.runningTool', locale, { tool: humanizeToolName(toolName) })
  }
  const label = t(entry.key, locale)
  const rawArg = entry.arg === undefined ? undefined : entry.arg(input)
  if (rawArg === undefined || rawArg.trim() === '') {
    return `${entry.emoji} ${label}…`
  }
  const arg = sanitizeArg(rawArg)
  const middle = entry.quote === false ? ` ${arg}` : `: "${arg}"`
  return `${entry.emoji} ${label}${middle}…`
}
