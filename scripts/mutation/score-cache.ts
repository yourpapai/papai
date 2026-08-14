// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { isMergedScore } from './score-merger.js'
import type { MergedScore } from './score-merger.js'

/** File name of the carried-over score store, written next to the paired Stryker reports. */
export const SCORE_CACHE_FILE = 'score-cache.json'

/** Bumped when the on-disk shape changes; a file at any other version reads as empty. */
export const SCORE_CACHE_VERSION = 1

/**
 * Write-side pruning window. There is deliberately no READ-side TTL: the fingerprint is an
 * exact content match, so an entry that still matches is still correct however old it is.
 * This bound exists only to stop a long-lived branch's store from growing without limit.
 */
export const SCORE_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface ScoreCacheEntry {
  readonly fingerprint: string
  readonly merged: MergedScore
  readonly measuredAt: number
}

export interface ScoreCacheFile {
  readonly version: number
  readonly entries: Record<string, ScoreCacheEntry>
}

export interface ScoreCache {
  /**
   * Returns the recorded score for `sourceFile` ONLY when `fingerprint` matches what was
   * recorded. The guard lives here, not in the caller, so no call site can consume a score
   * without proving the content it was measured from is still the content on disk.
   */
  readonly get: (sourceFile: string, fingerprint: string) => ScoreCacheEntry | undefined
  readonly set: (sourceFile: string, fingerprint: string, merged: MergedScore) => void
  /** Persist restored ∪ recorded entries, pruning stale ones. Call once at the end of a run. */
  readonly flush: () => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isScoreCacheEntry = (value: unknown): value is ScoreCacheEntry => {
  if (!isRecord(value)) return false
  if (typeof value['fingerprint'] !== 'string' || value['fingerprint'] === '') return false
  const measuredAt: unknown = value['measuredAt']
  if (typeof measuredAt !== 'number' || !Number.isFinite(measuredAt)) return false
  return isMergedScore(value['merged'])
}

/**
 * Read the store, treating anything unreadable as empty. A cache miss costs a re-measure;
 * a throw here would fail a gate over a corrupt convenience file, which is the wrong trade
 * in every case. Per-entry validation means one bad record cannot cost the whole run.
 */
const readCacheFile = (cachePath: string): Record<string, ScoreCacheEntry> => {
  try {
    if (!fs.existsSync(cachePath)) return {}
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (!isRecord(parsed) || parsed['version'] !== SCORE_CACHE_VERSION) return {}
    const raw: unknown = parsed['entries']
    if (!isRecord(raw)) return {}
    const valid: [string, ScoreCacheEntry][] = []
    for (const [sourceFile, entry] of Object.entries(raw)) {
      if (isScoreCacheEntry(entry)) valid.push([sourceFile, entry])
    }
    return Object.fromEntries(valid)
  } catch {
    return {}
  }
}

const writeCacheFile = (cachePath: string, entries: Record<string, ScoreCacheEntry>): void => {
  const cutoff = Date.now() - SCORE_CACHE_RETENTION_MS
  const kept = Object.entries(entries)
    .filter(([, entry]) => entry.measuredAt >= cutoff)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const file: ScoreCacheFile = { version: SCORE_CACHE_VERSION, entries: Object.fromEntries(kept) }
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, `${JSON.stringify(file, null, 2)}\n`)
  } catch {
    // A store that cannot be written costs the next run a re-measure. Failing the current
    // run over it would turn a convenience into a liability.
  }
}

/**
 * Open the carried-over score store. Reads fail open, writes are batched, and `flush` always
 * writes — including when nothing was recorded — so the CI cache-save step always has a path
 * to save and never warns about a missing file.
 */
export const openScoreCache = (cachePath: string): ScoreCache => {
  const entries = readCacheFile(cachePath)
  return {
    get: (sourceFile, fingerprint) => {
      const entry = entries[sourceFile]
      if (entry === undefined || entry.fingerprint !== fingerprint) return undefined
      return entry
    },
    set: (sourceFile, fingerprint, merged) => {
      entries[sourceFile] = { fingerprint, merged, measuredAt: Date.now() }
    },
    flush: () => {
      writeCacheFile(cachePath, entries)
    },
  }
}
