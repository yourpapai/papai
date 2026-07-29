// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

export interface CoverageCacheEntry {
  readonly value: ReadonlyArray<readonly [string, number]>
  readonly ts: number
}

export type CoverageCacheFile = { entries: Record<string, CoverageCacheEntry> }

export interface CoverageCache {
  readonly get: (key: string, ttlMs: number) => Map<string, number> | undefined
  readonly set: (key: string, value: Map<string, number>) => void
  /** Persist any pending `set` writes to disk. Batched: call once at the end of a run. */
  readonly flush: () => void
}

/**
 * Open the per-test coverage cache. Reads are best-effort and never throw into the caller:
 * a malformed cache file or entry is treated as a miss (and `get` returns `undefined`); a write
 * failure is swallowed (a write must not abort the run). This fail-open posture is the reason
 * `safeGetEntry` validates per-entry shape AND wraps `new Map(...)` in try/catch.
 *
 * Writes are batched: `set` only updates the in-memory map and marks it dirty; `flush` persists
 * once. Call `flush` at the end of a batch so N coverage misses don't trigger N full-file writes.
 */
export const openCoverageCache = (cachePath: string): CoverageCache => {
  const entries = readCacheFile(cachePath)
  let dirty = false
  return {
    get: (key, ttlMs) => safeGetEntry(entries, key, ttlMs),
    set: (key, value) => {
      entries[key] = { value: [...value.entries()], ts: Date.now() }
      dirty = true
    },
    flush: () => {
      if (!dirty) return
      writeCacheFile(cachePath, { entries })
      dirty = false
    },
  }
}

const safeGetEntry = (
  entries: Record<string, CoverageCacheEntry>,
  key: string,
  ttlMs: number,
): Map<string, number> | undefined => {
  const entry = entries[key]
  if (!isCoverageCacheEntry(entry)) return undefined
  if (Date.now() - entry.ts > ttlMs) return undefined
  try {
    return new Map(entry.value)
  } catch {
    return undefined
  }
}

const isCoverageCacheFile = (value: unknown): value is CoverageCacheFile => {
  if (typeof value !== 'object' || value === null) return false
  if (!('entries' in value)) return false
  const entries: unknown = value.entries
  return typeof entries === 'object' && entries !== null
}

const isCoverageCacheEntry = (value: unknown): value is CoverageCacheEntry => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!('ts' in value) || typeof value.ts !== 'number' || !Number.isFinite(value.ts)) return false
  if (!('value' in value) || !Array.isArray(value.value)) return false
  return value.value.every(isCachePair)
}

const isCachePair = (item: unknown): boolean => {
  if (!Array.isArray(item) || item.length !== 2) return false
  return typeof item[0] === 'string' && typeof item[1] === 'number'
}

const readCacheFile = (cachePath: string): Record<string, CoverageCacheEntry> => {
  try {
    if (!fs.existsSync(cachePath)) return {}
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (!isCoverageCacheFile(parsed)) return {}
    return parsed.entries
  } catch {
    return {}
  }
}

const writeCacheFile = (cachePath: string, cache: CoverageCacheFile): void => {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(cache))
  } catch {
    // best-effort cache persistence; a write failure must not abort the run
  }
}
