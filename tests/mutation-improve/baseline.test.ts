// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  bumpScore,
  parseBaseline,
  readBaseline,
  serializeBaseline,
  writeBaseline,
} from '../../mutation-improve/src/baseline.js'
import { isBaselineRecord } from '../../scripts/mutation/baseline.js'
import type { BaselineMap, BaselineRecord } from '../../scripts/mutation/baseline.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

/** A measurement consistent with the score formula: score === (killed + timeout) / scored. */
const measurement = (killed: number, timeout: number, scored: number): BaselineRecord => ({
  score: (killed + timeout) / scored,
  killed,
  timeout,
  scored,
})

describe('parseBaseline', () => {
  test('accepts the dual shape: a bare legacy number and a rich record side by side', () => {
    const map = parseBaseline(
      '{\n  "src/legacy.ts": 0.5,\n  "src/z.ts": { "score": 0.9, "killed": 9, "timeout": 0, "scored": 10 }\n}',
    )
    expect(map).toEqual({
      'src/legacy.ts': 0.5,
      'src/z.ts': { score: 0.9, killed: 9, timeout: 0, scored: 10 },
    })
  })

  // Identical interpretation with the PR gate: the guards are imported from
  // scripts/mutation/baseline.js, so a record the PR gate's loader rejects (or
  // accepts) behaves the same in the runner — no hand-synced second copy.
  test('rejects an arithmetically inconsistent record exactly like the PR gate loader', () => {
    expect(() => parseBaseline('{"src/a.ts": {"score": 0.9, "killed": 16, "timeout": 1, "scored": 20}}')).toThrow(
      /src\/a\.ts.*\(killed \+ timeout\) \/ scored/u,
    )
  })

  test('rejects a value that is neither a finite number nor a record', () => {
    expect(() => parseBaseline('{"src/a.ts": "0.5"}')).toThrow(/src\/a\.ts/u)
  })

  test('rejects a non-object document', () => {
    expect(() => parseBaseline('[]')).toThrow(/must be a JSON object/u)
  })
})

describe('serializeBaseline', () => {
  test('sorts keys and adds a trailing newline, preserving both entry shapes', () => {
    const out = serializeBaseline({
      'src/z.ts': measurement(9, 0, 10),
      'src/legacy.ts': 0.5,
    })
    expect(out).toBe(
      '{\n  "src/legacy.ts": 0.5,\n  "src/z.ts": {\n    "score": 0.9,\n    "killed": 9,\n    "timeout": 0,\n    "scored": 10\n  }\n}\n',
    )
  })

  test('parseBaseline + serializeBaseline round-trip is stable', () => {
    const map: BaselineMap = { 'src/z.ts': measurement(9, 0, 10), 'src/a.ts': 0.1 }
    expect(parseBaseline(serializeBaseline(map))).toEqual({ 'src/a.ts': 0.1, 'src/z.ts': measurement(9, 0, 10) })
  })
})

describe('bumpScore (record-level)', () => {
  test('a strictly-higher score replaces the record wholesale with the new counts', () => {
    const prev = measurement(4, 0, 10)
    const next = measurement(9, 0, 10)
    expect(bumpScore({ 'src/foo.ts': prev }, 'src/foo.ts', next)).toEqual({ 'src/foo.ts': next })
  })

  test('equal-or-lower over a rich record returns the same map with the previous record object untouched', () => {
    const prev = measurement(8, 0, 10)
    const equal = measurement(4, 4, 10)
    const lower = measurement(3, 0, 10)
    const bumpedEqual = bumpScore({ 'src/foo.ts': prev }, 'src/foo.ts', equal)
    expect(bumpedEqual['src/foo.ts']).toBe(prev)
    expect(bumpScore({ 'src/foo.ts': prev }, 'src/foo.ts', lower)['src/foo.ts']).toBe(prev)
  })

  test('a legacy bare entry at exactly its recorded score converts to a rich record at the unchanged floor', () => {
    const atFloor = measurement(7, 1, 10)
    expect(bumpScore({ 'src/foo.ts': 0.8 }, 'src/foo.ts', atFloor)).toEqual({
      'src/foo.ts': { score: 0.8, killed: 7, timeout: 1, scored: 10 },
    })
  })

  test('a lower measurement leaves a legacy bare entry untouched', () => {
    expect(bumpScore({ 'src/foo.ts': 0.8 }, 'src/foo.ts', measurement(1, 0, 4))).toEqual({ 'src/foo.ts': 0.8 })
  })

  test('a previously-unseen file creates a rich record from the measurement', () => {
    const next = measurement(7, 0, 10)
    expect(bumpScore({}, 'src/new.ts', next)).toEqual({ 'src/new.ts': next })
  })

  // skip-ratchet suppresses a no-op commit via reference identity; the same-map
  // return for a not-strictly-higher bump is what keeps that working.
  test('a no-op bump returns the identical map object', () => {
    const baseline: BaselineMap = { 'src/foo.ts': measurement(8, 0, 10) }
    expect(bumpScore(baseline, 'src/foo.ts', measurement(4, 4, 10))).toBe(baseline)
  })
})

describe('baseline IO', () => {
  test('readBaseline + writeBaseline round-trip through scripts/mutation/baseline.json with records', async () => {
    const repoRoot = makeTempDir('bl-')
    await mkdir(path.join(repoRoot, 'scripts', 'mutation'), { recursive: true })
    await writeBaseline(repoRoot, { 'src/a.ts': measurement(3, 0, 10) })
    const onDisk = await readFile(path.join(repoRoot, 'scripts', 'mutation', 'baseline.json'), 'utf8')
    expect(onDisk).toContain('"src/a.ts"')
    expect(onDisk).toContain('"scored": 10')
    const readBack = await readBaseline(repoRoot)
    expect(isBaselineRecord(readBack['src/a.ts'])).toBe(true)
  })

  test('readBaseline on a missing file returns empty map', async () => {
    const repoRoot = makeTempDir('bl-missing-')
    const map = await readBaseline(repoRoot)
    expect(map).toEqual({})
  })
})
