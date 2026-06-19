// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * A status entry for a tool. The optional `arg` extractor is the allowlist: only the
 * single field it reads is ever surfaced. `quote: false` renders the value bare
 * (used for hosts); otherwise it is wrapped in quotes.
 */
export type ToolStatusEntry = {
  emoji: string
  label: string
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
export const sanitizeArg = (value: string): string => {
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  return collapsed.length > MAX_ARG_LENGTH ? `${collapsed.slice(0, MAX_ARG_LENGTH)}…` : collapsed
}

const REGISTRY: Record<string, ToolStatusEntry> = {
  web_fetch: { emoji: '🌐', label: 'Fetching', quote: false, arg: hostOf },
  fetch_chat_link: { emoji: '🔗', label: 'Reading link', quote: false, arg: hostOf },
  search_memory: { emoji: '🔍', label: 'Searching memory', arg: (i) => getStringField(i, ['query']) },
  list_memory: { emoji: '🧠', label: 'Recalling memory' },
  remember_memory: { emoji: '🧠', label: 'Saving a memory' },
  search_memos: { emoji: '🔍', label: 'Searching memos', arg: (i) => getStringField(i, ['query']) },
  save_memo: { emoji: '📌', label: 'Saving a memo' },
  list_memos: { emoji: '📒', label: 'Listing memos' },
  create_task: { emoji: '📝', label: 'Creating task', arg: (i) => getStringField(i, ['title', 'name']) },
  update_task: { emoji: '✏️', label: 'Updating task' },
  delete_task: { emoji: '🗑️', label: 'Deleting task' },
  get_task: { emoji: '📄', label: 'Reading task' },
  list_tasks: { emoji: '📋', label: 'Listing tasks' },
  search_tasks: { emoji: '🔍', label: 'Searching tasks', arg: (i) => getStringField(i, ['query', 'text']) },
  count_tasks: { emoji: '🔢', label: 'Counting tasks' },
  add_comment: { emoji: '💬', label: 'Adding a comment' },
  create_project: { emoji: '📁', label: 'Creating project', arg: (i) => getStringField(i, ['name', 'title']) },
  list_projects: { emoji: '📁', label: 'Listing projects' },
  list_files: { emoji: '📎', label: 'Listing files' },
  search_staged_files: { emoji: '📎', label: 'Searching files', arg: (i) => getStringField(i, ['query']) },
  upload_attachment: { emoji: '📤', label: 'Attaching a file' },
  resolve_staged_file: { emoji: '📎', label: 'Attaching a file' },
  create_recurring_task: { emoji: '🔁', label: 'Scheduling a recurring task' },
  lookup_group_history: { emoji: '🕘', label: 'Checking history' },
  find_user: { emoji: '👤', label: 'Looking up a user' },
  get_current_time: { emoji: '🕒', label: 'Checking the time' },
}

/** Humanize a tool id for the fallback: last `__` segment (MCP/plugin) or stripped prefix, spaced + lowercased. */
const humanizeToolName = (toolName: string): string => {
  const base = toolName.includes('__')
    ? toolName.slice(toolName.lastIndexOf('__') + 2)
    : toolName.replace(/^(?:mcp|plugin)_/u, '')
  return base.replace(/[_-]+/gu, ' ').trim().toLowerCase()
}

/** Render the status line for a tool call (without the parallel "(+n)" suffix, which the reporter adds). */
export const formatToolStatus = (toolName: string, input: unknown): string => {
  const entry = REGISTRY[toolName]
  if (entry === undefined) {
    return `⚙️ Running ${humanizeToolName(toolName)}…`
  }
  const rawArg = entry.arg === undefined ? undefined : entry.arg(input)
  if (rawArg === undefined || rawArg.trim() === '') {
    return `${entry.emoji} ${entry.label}…`
  }
  const arg = sanitizeArg(rawArg)
  const middle = entry.quote === false ? ` ${arg}` : `: "${arg}"`
  return `${entry.emoji} ${entry.label}${middle}…`
}
