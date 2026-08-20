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
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('baseline', () => {
  test('serializeBaseline sorts keys and adds a trailing newline', () => {
    const out = serializeBaseline({ b: 1, a: 0.5 })
    expect(out).toBe('{\n  "a": 0.5,\n  "b": 1\n}\n')
  })

  test('parseBaseline + serializeBaseline round-trip is stable', () => {
    const map = { 'src/z.ts': 0.9, 'src/a.ts': 0.1 }
    expect(parseBaseline(serializeBaseline(map))).toEqual({ 'src/a.ts': 0.1, 'src/z.ts': 0.9 })
  })

  test('bumpScore raises the floor and never lowers it', () => {
    const before = { 'src/foo.ts': 0.4 }
    expect(bumpScore(before, 'src/foo.ts', 0.95)['src/foo.ts']).toBe(0.95)
    // a measured dip must not lower the floor
    expect(bumpScore(before, 'src/foo.ts', 0.2)['src/foo.ts']).toBe(0.4)
    // a previously-unseen file creates a new entry
    expect(bumpScore(before, 'src/new.ts', 0.7)['src/new.ts']).toBe(0.7)
  })

  test('readBaseline + writeBaseline round-trip through scripts/mutation/baseline.json', async () => {
    const repoRoot = makeTempDir('bl-')
    await mkdir(path.join(repoRoot, 'scripts', 'mutation'), { recursive: true })
    await writeBaseline(repoRoot, { 'src/a.ts': 0.3 })
    const onDisk = await readFile(path.join(repoRoot, 'scripts', 'mutation', 'baseline.json'), 'utf8')
    expect(onDisk).toContain('"src/a.ts": 0.3')
    const readBack = await readBaseline(repoRoot)
    expect(readBack['src/a.ts']).toBe(0.3)
  })

  test('readBaseline on a missing file returns empty map', async () => {
    const repoRoot = makeTempDir('bl-missing-')
    const map = await readBaseline(repoRoot)
    expect(map).toEqual({})
  })
})
