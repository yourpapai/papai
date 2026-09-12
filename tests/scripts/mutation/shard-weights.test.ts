// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createDefaultWeightDeps,
  DEFAULT_WEIGHT_SECONDS,
  estimateWeight,
  estimateWeights,
  MIN_WEIGHT_SECONDS,
  WEIGHT_INTERCEPT_SECONDS,
  WEIGHT_SECONDS_PER_LINE,
} from '../../../scripts/mutation/shard-weights.js'
import type { WeightDeps } from '../../../scripts/mutation/shard-weights.js'

const depsWith = (lines: Record<string, number | null>): WeightDeps => ({
  countLines: (relPath) => lines[relPath] ?? null,
})

describe('estimateWeight', () => {
  test('scales with source length using the documented fit', () => {
    const deps = depsWith({ 'src/a.ts': 100, 'src/b.ts': 400 })
    expect(estimateWeight('src/a.ts', deps)).toBeCloseTo(WEIGHT_INTERCEPT_SECONDS + WEIGHT_SECONDS_PER_LINE * 100, 6)
    expect(estimateWeight('src/b.ts', deps)).toBeCloseTo(WEIGHT_INTERCEPT_SECONDS + WEIGHT_SECONDS_PER_LINE * 400, 6)
  })

  test('a longer file never weighs less than a shorter one', () => {
    const deps = depsWith({ 'src/short.ts': 10, 'src/long.ts': 5000 })
    expect(estimateWeight('src/long.ts', deps)).toBeGreaterThan(estimateWeight('src/short.ts', deps))
  })

  // The spec requires an unreadable target to still be assigned and measured, so the
  // estimator must yield a usable number rather than throwing or returning null.
  test('falls back to the documented default when the source cannot be read', () => {
    const deps = depsWith({})
    expect(estimateWeight('src/vanished.ts', deps)).toBe(DEFAULT_WEIGHT_SECONDS)
  })

  test('an empty source still weighs at least the floor', () => {
    const deps = depsWith({ 'src/empty.ts': 0 })
    const weight = estimateWeight('src/empty.ts', deps)
    expect(weight).toBeGreaterThanOrEqual(MIN_WEIGHT_SECONDS)
    expect(weight).toBeGreaterThan(0)
  })

  // A zero or negative weight would make the packer's "least loaded bin" arbitrary and
  // could make a shard's estimated load stop growing as targets are added to it.
  test('a nonsense line count never produces a zero or negative weight', () => {
    for (const lines of [-1, Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      const weight = estimateWeight('src/odd.ts', depsWith({ 'src/odd.ts': lines }))
      expect(Number.isFinite(weight)).toBe(true)
      expect(weight).toBeGreaterThanOrEqual(MIN_WEIGHT_SECONDS)
    }
  })
})

describe('estimateWeights', () => {
  test('returns one finite positive weight per requested file, preserving order', () => {
    const deps = depsWith({ 'src/a.ts': 100, 'src/c.ts': 300 })
    const weights = estimateWeights(['src/a.ts', 'src/b.ts', 'src/c.ts'], deps)
    expect([...weights.keys()]).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    for (const weight of weights.values()) {
      expect(Number.isFinite(weight)).toBe(true)
      expect(weight).toBeGreaterThan(0)
    }
    expect(weights.get('src/b.ts')).toBe(DEFAULT_WEIGHT_SECONDS)
  })

  test('a repeated file is weighed once', () => {
    const weights = estimateWeights(['src/a.ts', 'src/a.ts'], depsWith({ 'src/a.ts': 10 }))
    expect(weights.size).toBe(1)
  })
})

describe('createDefaultWeightDeps', () => {
  test('counts lines of a real file and reports null for a missing one', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-weights-'))
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/three.ts'), 'a\nb\nc\n')
    const deps = createDefaultWeightDeps(root)
    expect(deps.countLines('src/three.ts')).toBe(3)
    expect(deps.countLines('src/missing.ts')).toBeNull()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('a directory in place of a source file reads as unavailable, not a crash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-weights-'))
    fs.mkdirSync(path.join(root, 'src/nested.ts'), { recursive: true })
    const deps = createDefaultWeightDeps(root)
    expect(deps.countLines('src/nested.ts')).toBeNull()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
