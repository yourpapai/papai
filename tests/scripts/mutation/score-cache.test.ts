// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ScoreCacheFile } from '../../../scripts/mutation/score-cache.js'
import { openScoreCache, SCORE_CACHE_RETENTION_MS, SCORE_CACHE_VERSION } from '../../../scripts/mutation/score-cache.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'

const cachePath = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'score-cache-')), 'score-cache.json')

const merged = (score: number): MergedScore => ({
  killed: 1,
  survived: 1,
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: 2,
  scored: 2,
  score,
})

const readCacheJson = (filePath: string): ScoreCacheFile => {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed) || !('version' in parsed)) {
    throw new Error(`cache file at ${filePath} is not a ScoreCacheFile`)
  }
  const { entries, version } = parsed
  if (typeof version !== 'number' || typeof entries !== 'object' || entries === null) {
    throw new Error(`cache file at ${filePath} has the wrong shape`)
  }
  return { version, entries: Object.fromEntries(Object.entries(entries)) }
}

const readEntryKeys = (filePath: string): string[] => Object.keys(readCacheJson(filePath).entries)

const writeRaw = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('openScoreCache', () => {
  test('round-trips an entry through flush and reopen', () => {
    const file = cachePath()
    const writer = openScoreCache(file)
    writer.set('src/a.ts', 'fp-a', merged(0.5))
    writer.flush()

    const reader = openScoreCache(file)
    const entry = reader.get('src/a.ts', 'fp-a')
    expect(entry?.merged.score).toBe(0.5)
    expect(entry?.measuredAt).toBeGreaterThan(0)
  })

  test('reads as empty when the file does not exist', () => {
    expect(openScoreCache(cachePath()).get('src/a.ts', 'fp-a')).toBeUndefined()
  })

  /**
   * The guard lives INSIDE get() and takes the fingerprint as an argument, so no call site
   * can consume an entry without proving the content still matches. This is the property
   * that makes restore-keys prefix matching, rebases and racing CI runs safe: a wrong blob
   * costs runtime, never correctness.
   */
  test('misses when the fingerprint does not match', () => {
    const file = cachePath()
    const cache = openScoreCache(file)
    cache.set('src/a.ts', 'fp-old', merged(0.5))
    cache.flush()
    expect(openScoreCache(file).get('src/a.ts', 'fp-new')).toBeUndefined()
  })

  test('misses for a file that was never recorded', () => {
    const file = cachePath()
    const cache = openScoreCache(file)
    cache.set('src/a.ts', 'fp-a', merged(0.5))
    cache.flush()
    expect(openScoreCache(file).get('src/b.ts', 'fp-a')).toBeUndefined()
  })

  test('treats malformed JSON as empty rather than throwing', () => {
    const file = cachePath()
    writeRaw(file, '{not json at all')
    const cache = openScoreCache(file)
    expect(cache.get('src/a.ts', 'fp-a')).toBeUndefined()
    expect(() => {
      cache.set('src/a.ts', 'fp-a', merged(0.9))
      cache.flush()
    }).not.toThrow()
    expect(openScoreCache(file).get('src/a.ts', 'fp-a')?.merged.score).toBe(0.9)
  })

  test('ignores a cache file written by a different version', () => {
    const file = cachePath()
    writeRaw(
      file,
      JSON.stringify({
        version: SCORE_CACHE_VERSION + 1,
        entries: { 'src/a.ts': { fingerprint: 'fp-a', merged: merged(0.5), measuredAt: Date.now() } },
      }),
    )
    expect(openScoreCache(file).get('src/a.ts', 'fp-a')).toBeUndefined()
  })

  // One hand-edited or truncated entry must not cost the whole run its cache.
  test('drops a corrupt entry without poisoning its siblings', () => {
    const file = cachePath()
    writeRaw(
      file,
      JSON.stringify({
        version: SCORE_CACHE_VERSION,
        entries: {
          'src/bad.ts': { fingerprint: 'fp-bad', merged: { ...merged(0.5), score: 'high' }, measuredAt: Date.now() },
          'src/good.ts': { fingerprint: 'fp-good', merged: merged(0.75), measuredAt: Date.now() },
        },
      }),
    )
    const cache = openScoreCache(file)
    expect(cache.get('src/bad.ts', 'fp-bad')).toBeUndefined()
    expect(cache.get('src/good.ts', 'fp-good')?.merged.score).toBe(0.75)
  })

  test('drops entries missing a fingerprint or a timestamp', () => {
    const file = cachePath()
    writeRaw(
      file,
      JSON.stringify({
        version: SCORE_CACHE_VERSION,
        entries: {
          'src/nofp.ts': { merged: merged(0.5), measuredAt: Date.now() },
          'src/nots.ts': { fingerprint: 'fp', merged: merged(0.5) },
        },
      }),
    )
    const cache = openScoreCache(file)
    expect(cache.get('src/nofp.ts', 'fp')).toBeUndefined()
    expect(cache.get('src/nots.ts', 'fp')).toBeUndefined()
  })

  test('swallows a write failure instead of failing the run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-cache-ro-'))
    const cache = openScoreCache(path.join(dir, 'nested'))
    fs.mkdirSync(path.join(dir, 'nested'))
    cache.set('src/a.ts', 'fp-a', merged(0.5))
    expect(() => {
      cache.flush()
    }).not.toThrow()
  })

  test('preserves entries it did not touch, so history is never dropped', () => {
    const file = cachePath()
    const first = openScoreCache(file)
    first.set('src/a.ts', 'fp-a', merged(0.5))
    first.flush()

    const second = openScoreCache(file)
    second.set('src/b.ts', 'fp-b', merged(0.6))
    second.flush()

    const third = openScoreCache(file)
    expect(third.get('src/a.ts', 'fp-a')?.merged.score).toBe(0.5)
    expect(third.get('src/b.ts', 'fp-b')?.merged.score).toBe(0.6)
  })

  test('overwrites an entry when the same file is measured again', () => {
    const file = cachePath()
    const cache = openScoreCache(file)
    cache.set('src/a.ts', 'fp-old', merged(0.5))
    cache.set('src/a.ts', 'fp-new', merged(0.9))
    cache.flush()
    const reader = openScoreCache(file)
    expect(reader.get('src/a.ts', 'fp-old')).toBeUndefined()
    expect(reader.get('src/a.ts', 'fp-new')?.merged.score).toBe(0.9)
  })

  /**
   * There is no read-side TTL — the fingerprint is exact, so an old entry that still
   * matches is still correct. Retention is write-side size control only, which is why it
   * is asserted on what survives a flush rather than on what get() returns.
   */
  test('prunes entries past the retention window on write', () => {
    const file = cachePath()
    const stale = Date.now() - SCORE_CACHE_RETENTION_MS - 1000
    writeRaw(
      file,
      JSON.stringify({
        version: SCORE_CACHE_VERSION,
        entries: {
          'src/stale.ts': { fingerprint: 'fp-stale', merged: merged(0.5), measuredAt: stale },
          'src/fresh.ts': { fingerprint: 'fp-fresh', merged: merged(0.6), measuredAt: Date.now() },
        },
      }),
    )
    const cache = openScoreCache(file)
    cache.set('src/new.ts', 'fp-new', merged(0.7))
    cache.flush()

    expect(readEntryKeys(file).toSorted()).toEqual(['src/fresh.ts', 'src/new.ts'])
  })

  test('writes the file even when nothing was recorded, so a CI save step always has a path', () => {
    const file = cachePath()
    openScoreCache(file).flush()
    expect(fs.existsSync(file)).toBe(true)
    expect(readCacheJson(file)).toEqual({ version: SCORE_CACHE_VERSION, entries: {} })
  })

  test('writes deterministically sorted entries', () => {
    const file = cachePath()
    const cache = openScoreCache(file)
    cache.set('src/z.ts', 'fp-z', merged(0.5))
    cache.set('src/a.ts', 'fp-a', merged(0.5))
    cache.flush()
    expect(readEntryKeys(file)).toEqual(['src/a.ts', 'src/z.ts'])
  })
})
