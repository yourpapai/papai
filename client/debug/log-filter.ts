// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import Fuse from 'fuse.js'

import type { LogEntry } from '../../src/debug/schemas.js'
import type { FuseResult, SearchableLogEntry } from './types.js'

export function flattenLogEntry(entry: LogEntry): string {
  const parts: string[] = []
  parts.push(entry.msg)
  if (entry.scope !== undefined) parts.push(entry.scope)

  function extract(value: unknown): void {
    if (value === null || value === undefined) return
    if (typeof value === 'string') parts.push(value)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(String(value))
    else if (Array.isArray(value)) {
      for (const item of value) extract(item)
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        parts.push(k)
        extract(v)
      }
    }
  }

  const standardFields = new Set(['time', 'level', 'msg', 'scope'])
  for (const [key, value] of Object.entries(entry)) {
    if (!standardFields.has(key)) {
      parts.push(key)
      extract(value)
    }
  }
  return parts.join(' ')
}

export type LogSearcher = { search: (query: string) => Array<{ item: SearchableLogEntry }> }

export function updateFuseIndex(logs: readonly LogEntry[]): LogSearcher | null {
  if (typeof Fuse === 'undefined') return null

  const searchableLogs = logs.map((log) => ({ ...log, _searchText: flattenLogEntry(log) }))
  return new Fuse(searchableLogs, {
    keys: [
      { name: 'msg', weight: 2 },
      { name: 'scope', weight: 1.5 },
      { name: '_searchText', weight: 1 },
    ],
    threshold: 0.4,
    includeScore: false,
    ignoreLocation: true,
    minMatchCharLength: 2,
  })
}

export function filterLogs(
  logs: readonly LogEntry[],
  minLevel: number,
  scope: string,
  query: string,
  fuseInstance: LogSearcher | null,
  turnId?: string,
): LogEntry[] {
  if (query === '') {
    return logs.filter((e) => {
      if (e.level < minLevel) return false
      if (scope !== '' && e.scope !== scope) return false
      if (turnId !== undefined && turnId !== '' && e['turnId'] !== turnId) return false
      return true
    })
  }

  let filtered: LogEntry[]
  if (fuseInstance === null) {
    filtered = [...logs]
  } else {
    const fuseResults = fuseInstance.search(query) as FuseResult<SearchableLogEntry>[]
    filtered = fuseResults.map((r) => r.item)
  }

  return filtered.filter((e) => {
    if (e.level < minLevel) return false
    if (scope !== '' && e.scope !== scope) return false
    if (turnId !== undefined && turnId !== '' && e['turnId'] !== turnId) return false
    return true
  })
}
