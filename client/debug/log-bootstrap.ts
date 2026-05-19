// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from '../../src/debug/schemas.js'
import { parseLogEntry } from '../../src/debug/schemas.js'

export function parseLogsArray(logs: readonly unknown[]): LogEntry[] {
  const parsedLogs: LogEntry[] = []
  for (const log of logs) {
    try {
      parsedLogs.push(parseLogEntry(log))
    } catch {
      // Skip invalid entries
    }
  }
  return parsedLogs
}

export function collectScopes(logs: readonly LogEntry[]): Set<string> {
  const scopes = new Set<string>()
  for (const entry of logs) {
    if (entry.scope !== undefined) scopes.add(entry.scope)
  }
  return scopes
}

export async function fetchInitialLogs(): Promise<unknown[]> {
  const res = await fetch('/logs')
  if (!res.ok) return []
  const body: unknown = await res.json()
  if (!Array.isArray(body)) return []
  return body as unknown[]
}
