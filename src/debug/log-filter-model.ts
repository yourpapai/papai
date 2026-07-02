// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from './log-buffer.js'

/** Selectable token representing entries that carry no `scope` field. */
export const NONE_TOKEN = '(none)'

export type LogFilter = {
  /** Scope patterns to allow; empty means "all scopes". */
  include: string[]
  /** Scope patterns to reject; always wins over include. */
  exclude: string[]
  /** Minimum pino numeric level (>=). */
  level: number
  turnId?: string
  /** Case-insensitive substring across all fields. */
  q?: string
}

/**
 * Match a scope pattern against a concrete scope string.
 * - `*` (lone wildcard) → matches every scope.
 * - `chat:*` (wildcard) → prefix on ':' boundaries.
 * - `chat` (bare namespace, no ':' or '*') → prefix on ':' boundaries.
 * - anything else → exact match. Note: a trailing colon (e.g. `chat:`) is
 *   treated as an exact-match pattern, not a prefix; use `chat` or `chat:*`
 *   to match a namespace and all its children.
 */
export function matchesScope(pattern: string, scope: string): boolean {
  if (pattern === '*') return true
  if (pattern === scope) return true
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2)
    return scope === prefix || scope.startsWith(`${prefix}:`)
  }
  if (!pattern.includes(':') && !pattern.includes('*')) {
    return scope === pattern || scope.startsWith(`${pattern}:`)
  }
  return false
}

const STANDARD_FIELDS = new Set(['time', 'level', 'msg', 'scope'])

/**
 * Flatten an entry's msg, scope, and every metadata key/value into one searchable string.
 * Assumes acyclic input (pino JSON entries are always acyclic).
 */
export function flattenLogEntry(entry: LogEntry): string {
  const parts: string[] = [entry.msg]
  if (entry.scope !== undefined) parts.push(entry.scope)

  const extract = (value: unknown): void => {
    if (value === null || value === undefined) return
    if (typeof value === 'string') parts.push(value)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(String(value))
    else if (Array.isArray(value)) for (const item of value) extract(item)
    else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        parts.push(k)
        extract(v)
      }
    }
  }

  for (const [key, value] of Object.entries(entry)) {
    if (!STANDARD_FIELDS.has(key)) {
      parts.push(key)
      extract(value)
    }
  }
  return parts.join(' ')
}

function scopePasses(scope: string | undefined, include: string[], exclude: string[]): boolean {
  if (scope === undefined) {
    if (include.length > 0 && !include.includes(NONE_TOKEN)) return false
    if (exclude.includes(NONE_TOKEN)) return false
    return true
  }
  if (include.length > 0) {
    const allowed = include.some((p) => p !== NONE_TOKEN && matchesScope(p, scope))
    if (!allowed) return false
  }
  if (exclude.some((p) => p !== NONE_TOKEN && matchesScope(p, scope))) return false
  return true
}

export function entryMatchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (entry.level < filter.level) return false
  if (filter.turnId !== undefined && filter.turnId !== '' && entry['turnId'] !== filter.turnId) return false
  if (!scopePasses(entry.scope, filter.include, filter.exclude)) return false
  if (filter.q !== undefined && filter.q !== '') {
    if (!flattenLogEntry(entry).toLowerCase().includes(filter.q.toLowerCase())) return false
  }
  return true
}

export function applyFilter(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  return entries.filter((e) => entryMatchesFilter(e, filter))
}

/** Parse a LogFilter out of URL query params (repeated include/exclude supported). */
export function parseLogFilter(params: URLSearchParams): LogFilter {
  const filter: LogFilter = {
    include: params.getAll('include').filter((s) => s !== ''),
    exclude: params.getAll('exclude').filter((s) => s !== ''),
    level: 0,
  }
  const levelRaw = params.get('level')
  if (levelRaw !== null && levelRaw !== '') {
    const parsed = Number.parseInt(levelRaw, 10)
    if (!Number.isNaN(parsed)) filter.level = parsed
  }
  const turnId = params.get('turnId')
  if (turnId !== null && turnId !== '') filter.turnId = turnId
  const q = params.get('q')
  if (q !== null && q !== '') filter.q = q
  return filter
}
