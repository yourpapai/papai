// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitGlobal } from './event-bus.js'
import { applyFilter, type LogFilter } from './log-filter-model.js'

export type LogEntry = {
  level: number
  time: string
  scope?: string
  turnId?: string
  msg: string
  [key: string]: unknown
}

type SearchParams = LogFilter & {
  limit?: number
  /** Cursor for backward paging: return only entries with `time` strictly less than this ISO timestamp. */
  before?: string
}

type BufferStats = {
  count: number
  capacity: number
  oldest: string | null
  newest: string | null
}

const DEFAULT_CAPACITY = 65535

function getCapacity(): number {
  const env = process.env['DEBUG_LOG_BUFFER_SIZE']
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_CAPACITY
}

/** @public -- used directly by tests with small capacity */
export class LogRingBuffer {
  private buffer: LogEntry[] = []
  private head = 0
  readonly capacity: number

  constructor(capacity: number = getCapacity()) {
    this.capacity = capacity
  }

  push(entry: LogEntry): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(entry)
    } else {
      this.buffer[this.head] = entry
      this.head = (this.head + 1) % this.capacity
    }
    emitGlobal('log:entry', entry as Record<string, unknown>)
  }

  entries(): LogEntry[] {
    if (this.buffer.length < this.capacity) return this.buffer.slice()
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]
  }

  search(params: SearchParams): LogEntry[] {
    let results = applyFilter(this.entries(), params)
    if (params.before !== undefined) {
      results = results.filter((e) => e.time < params.before!)
    }
    const limit = params.limit ?? 100
    return results.slice(-limit)
  }

  countMatching(filter: LogFilter): number {
    return applyFilter(this.entries(), filter).length
  }

  distinctScopes(): Array<{ scope: string; count: number }> {
    const counts = new Map<string, number>()
    for (const e of this.entries()) {
      if (e.scope !== undefined) counts.set(e.scope, (counts.get(e.scope) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => a.scope.localeCompare(b.scope))
  }

  stats(): BufferStats {
    if (this.buffer.length === 0) return { count: 0, capacity: this.capacity, oldest: null, newest: null }
    const all = this.entries()
    return {
      count: this.buffer.length,
      capacity: this.capacity,
      oldest: all[0]!.time,
      newest: all[all.length - 1]!.time,
    }
  }

  clear(): void {
    this.buffer.length = 0
    this.head = 0
  }
}

/** @public -- default instance, used by server.ts routes */
export const logBuffer = new LogRingBuffer()

function isLogEntry(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null) return false
  if (!('level' in value) || !('msg' in value) || !('time' in value)) return false
  return typeof value.level === 'number' && typeof value.msg === 'string' && typeof value.time === 'string'
}

/** @public -- pino DestinationStream adapter, attached via logMultistream.add() */
export const logBufferStream = {
  write(chunk: string): void {
    try {
      const parsed: unknown = JSON.parse(chunk)
      if (isLogEntry(parsed)) {
        logBuffer.push(parsed)
      }
    } catch {
      // Skip malformed lines — pino always writes valid JSON, but be defensive
    }
  },
}
