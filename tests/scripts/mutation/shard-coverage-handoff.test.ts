// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { coverageMapReaderFor, readShardPlan, writeShardPlan } from '../../../scripts/mutation/shard-io.js'
import { SHARD_PLAN_VERSION } from '../../../scripts/mutation/shard-plan.js'
import type { ShardPlanManifest } from '../../../scripts/mutation/shard-plan.js'

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'shard-io-'))

const manifest = (overrides: Partial<ShardPlanManifest> = {}): ShardPlanManifest => ({
  version: SHARD_PLAN_VERSION,
  baseRef: 'origin/master',
  targets: ['src/a.ts', 'src/b.ts'],
  toMeasure: ['src/a.ts', 'src/b.ts'],
  reused: [],
  shardCount: 2,
  shards: [
    { index: 0, targets: ['src/a.ts'], estimatedSeconds: 110 },
    { index: 1, targets: ['src/b.ts'], estimatedSeconds: 120 },
  ],
  coverageMap: { 'src/a.ts': ['tests/a.test.ts'], 'src/b.ts': ['tests/b.test.ts'] },
  budget: {
    targetWallSeconds: 360,
    preparationSeconds: 1.2,
    budgetSeconds: 298.8,
    cap: 12,
    singleShardThresholdSeconds: 330,
  },
  ...overrides,
})

describe('shard plan serialization', () => {
  test('round-trips the manifest including the coverage map', () => {
    const root = tmp()
    const file = path.join(root, 'plan.json')
    const original = manifest()
    writeShardPlan(file, original)
    expect(readShardPlan(file)).toEqual(original)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('creates the directory it is asked to write into', () => {
    const root = tmp()
    const file = path.join(root, 'nested', 'deeper', 'plan.json')
    writeShardPlan(file, manifest())
    expect(fs.existsSync(file)).toBe(true)
    fs.rmSync(root, { recursive: true, force: true })
  })

  describe('reads fail closed to null rather than throwing', () => {
    test('a missing file', () => {
      expect(readShardPlan(path.join(tmp(), 'absent.json'))).toBeNull()
    })

    test('unparseable content', () => {
      const root = tmp()
      const file = path.join(root, 'plan.json')
      fs.writeFileSync(file, '{ not json')
      expect(readShardPlan(file)).toBeNull()
      fs.rmSync(root, { recursive: true, force: true })
    })

    test('a manifest from a different version', () => {
      const root = tmp()
      const file = path.join(root, 'plan.json')
      fs.writeFileSync(file, JSON.stringify({ ...manifest(), version: SHARD_PLAN_VERSION + 1 }))
      expect(readShardPlan(file)).toBeNull()
      fs.rmSync(root, { recursive: true, force: true })
    })

    test('a structurally wrong manifest', () => {
      const root = tmp()
      const file = path.join(root, 'plan.json')
      fs.writeFileSync(file, JSON.stringify({ version: SHARD_PLAN_VERSION, targets: 'not-an-array' }))
      expect(readShardPlan(file)).toBeNull()
      fs.rmSync(root, { recursive: true, force: true })
    })
  })
})

/** `coverageMapReaderFor` returns a reader for any non-null manifest; unwrap once, here. */
const readerFor = (m: ShardPlanManifest): ((files: readonly string[]) => Record<string, string[]>) => {
  const reader = coverageMapReaderFor(m)
  if (reader === undefined) throw new Error('expected a reader for a non-null manifest')
  return reader
}

describe('coverageMapReaderFor', () => {
  // The point of publishing the map: a shard consuming it must not spawn a single coverage run.
  // Rebuilding per shard costs ~9% of total wall (design.md D4).
  test('serves the published attribution without any coverage work', () => {
    expect(readerFor(manifest())(['src/a.ts'])).toEqual({ 'src/a.ts': ['tests/a.test.ts'] })
  })

  test('narrows to the requested targets, not the whole run', () => {
    expect(Object.keys(readerFor(manifest())(['src/b.ts']))).toEqual(['src/b.ts'])
  })

  test('omits a target the plan recorded no covering test for', () => {
    const reader = readerFor(manifest({ coverageMap: { 'src/a.ts': ['tests/a.test.ts'] } }))
    expect(reader(['src/a.ts', 'src/b.ts'])).toEqual({ 'src/a.ts': ['tests/a.test.ts'] })
  })

  test('an empty published map still serves, rather than falling back', () => {
    expect(readerFor(manifest({ coverageMap: {} }))(['src/a.ts'])).toEqual({})
  })

  // The spec requires an executor that cannot consume the shared preparation to compute its own.
  // Returning undefined is exactly what makes pairedRun fall back to its production builder.
  test('no manifest means no reader, so the shard builds its own map', () => {
    expect(coverageMapReaderFor(null)).toBeUndefined()
  })
})
