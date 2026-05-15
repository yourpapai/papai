// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import Fuse from 'fuse.js'

import type { LogEntry } from '../../src/debug/schemas.js'
import { escapeHtml, formatTime, levelClass, levelName } from './helpers.js'
import type { FuseResult, SearchableLogEntry } from './types.js'

type LogModalElements = {
  $logModal: HTMLElement
  $logModalTitle: HTMLElement
  $logModalBody: HTMLElement
  $logModalClose: HTMLElement
}

type LogFilterElements = {
  $logLevelFilter: HTMLSelectElement
  $logScopeFilter: HTMLSelectElement
  $logSearch: HTMLInputElement
  $logClear: HTMLElement
  $logAutoscroll: HTMLElement
}

export function getLogModalElements(): LogModalElements {
  return {
    $logModal: document.getElementById('log-modal')!,
    $logModalTitle: document.getElementById('log-modal-title')!,
    $logModalBody: document.getElementById('log-modal-body')!,
    $logModalClose: document.getElementById('log-modal-close')!,
  }
}

export function getLogFilterElements(): LogFilterElements {
  const $logLevelFilter = document.querySelector<HTMLSelectElement>('#log-level-filter')
  const $logScopeFilter = document.querySelector<HTMLSelectElement>('#log-scope-filter')
  const $logSearch = document.querySelector<HTMLInputElement>('#log-search')
  const $logClear = document.getElementById('log-clear')
  const $logAutoscroll = document.getElementById('log-autoscroll')

  if (
    $logLevelFilter === null ||
    $logScopeFilter === null ||
    $logSearch === null ||
    $logClear === null ||
    $logAutoscroll === null
  ) {
    throw new Error('Log filter elements not found in DOM')
  }

  return {
    $logLevelFilter,
    $logScopeFilter,
    $logSearch,
    $logClear,
    $logAutoscroll,
  }
}

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

export function updateFuseIndex(
  logs: LogEntry[],
): { search: (query: string) => Array<{ item: SearchableLogEntry }> } | null {
  // Check if Fuse is loaded (from CDN)
  if (typeof Fuse === 'undefined') {
    return null
  }

  const searchableLogs = logs.map((log) => ({
    ...log,
    _searchText: flattenLogEntry(log),
  }))
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

export function renderLogEntry(entry: LogEntry): string {
  const cls = levelClass(entry.level)
  const time = formatTime(entry.time)
  const scopeStr = entry.scope === undefined ? '' : ` ${entry.scope}`
  return `<div class="log-entry ${cls}"><span class="log-meta">${time} ${levelName(entry.level)}${scopeStr}</span><span class="log-msg">${escapeHtml(entry.msg)}</span></div>`
}

export function filterLogs(
  logs: LogEntry[],
  minLevel: number,
  scope: string,
  query: string,
  fuseInstance: ReturnType<typeof updateFuseIndex>,
): LogEntry[] {
  if (query === '') {
    return logs.filter((e: LogEntry) => {
      if (e.level < minLevel) return false
      if (scope !== '' && e.scope !== scope) return false
      return true
    })
  }

  let filtered: LogEntry[]
  if (fuseInstance === null) {
    filtered = [...logs]
  } else {
    const fuseResults = fuseInstance.search(query) as FuseResult<SearchableLogEntry>[]
    filtered = fuseResults.map((r: FuseResult<SearchableLogEntry>) => r.item)
  }

  return filtered.filter((e) => {
    if (e.level < minLevel) return false
    if (scope !== '' && e.scope !== scope) return false
    return true
  })
}
