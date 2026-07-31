// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isBaselineMap } from '../../../scripts/mutation/baseline.js'
import type { BaselineMap, PerFileScore } from '../../../scripts/mutation/baseline.js'
import {
  parseSeedFromCliArgs,
  SCORES_FILE,
  seedFromScores,
  writeScoresFile,
} from '../../../scripts/mutation/seed-from.js'
import type { SeedFromDeps } from '../../../scripts/mutation/seed-from.js'

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'papai-seed-from-'))

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, JSON.stringify(value))
}

const readMap = (filePath: string): BaselineMap => {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isBaselineMap(parsed)) throw new Error(`file at ${filePath} is not a BaselineMap`)
  return parsed
}

const scored = (sourceFile: string, scoreValue: number): PerFileScore => ({
  sourceFile,
  merged: {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    timeout: 0,
    compileError: 0,
    ignored: 0,
    runtimeError: 0,
    pending: 0,
    total: 1,
    scored: 1,
    score: scoreValue,
  },
})

const unscored = (sourceFile: string): PerFileScore => ({
  sourceFile,
  merged: {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    timeout: 0,
    compileError: 0,
    ignored: 0,
    runtimeError: 0,
    pending: 0,
    total: 0,
    scored: 0,
    score: 0,
  },
})

describe('parseSeedFromCliArgs', () => {
  test('parses --scores with no fresh-base', () => {
    expect(parseSeedFromCliArgs(['--scores=reports/paired/scores.json'])).toEqual({
      kind: 'ok',
      scoresPath: 'reports/paired/scores.json',
      freshBase: undefined,
    })
  })

  test('parses --scores with --fresh-base', () => {
    expect(parseSeedFromCliArgs(['--scores=a.json', '--fresh-base=abc123'])).toEqual({
      kind: 'ok',
      scoresPath: 'a.json',
      freshBase: 'abc123',
    })
  })

  test('rejects missing --scores', () => {
    expect(parseSeedFromCliArgs([])).toEqual({
      kind: 'usageError',
      reason: 'missing required argument --scores=PATH',
    })
  })

  test('rejects --fresh-base without --scores as missing scores', () => {
    expect(parseSeedFromCliArgs(['--fresh-base=abc123'])).toEqual({
      kind: 'usageError',
      reason: 'missing required argument --scores=PATH',
    })
  })

  test('rejects empty --scores value', () => {
    expect(parseSeedFromCliArgs(['--scores='])).toEqual({
      kind: 'usageError',
      reason: 'scores must not be empty',
    })
  })

  test('rejects duplicate --scores', () => {
    expect(parseSeedFromCliArgs(['--scores=a.json', '--scores=b.json'])).toEqual({
      kind: 'usageError',
      reason: 'scores must be provided at most once',
    })
  })

  test('rejects duplicate --fresh-base', () => {
    expect(parseSeedFromCliArgs(['--scores=a.json', '--fresh-base=x', '--fresh-base=y'])).toEqual({
      kind: 'usageError',
      reason: 'fresh-base must be provided at most once',
    })
  })

  test('rejects empty --fresh-base value', () => {
    expect(parseSeedFromCliArgs(['--scores=a.json', '--fresh-base='])).toEqual({
      kind: 'usageError',
      reason: 'fresh-base must not be empty',
    })
  })

  test('rejects unknown flags', () => {
    expect(parseSeedFromCliArgs(['--scores=a.json', '--update-baseline'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument --update-baseline',
    })
  })

  test('rejects unexpected positional arguments', () => {
    expect(parseSeedFromCliArgs(['--scores=a.json', 'extra.json'])).toEqual({
      kind: 'usageError',
      reason: 'unexpected positional argument extra.json',
    })
  })
})

describe('writeScoresFile', () => {
  test('pins the scores file name consumed by the CI re-seed step', () => {
    expect(SCORES_FILE).toBe('scores.json')
  })

  test('writes a sorted BaselineMap excluding entries with no scoreable mutants', () => {
    const scoresPath = path.join(tmpDir(), 'nested', SCORES_FILE)

    writeScoresFile(scoresPath, [scored('src/z.ts', 0.3), scored('src/a.ts', 0.9), unscored('src/u.ts')])

    expect(readMap(scoresPath)).toEqual({ 'src/a.ts': 0.9, 'src/z.ts': 0.3 })
    expect(Object.keys(readMap(scoresPath))).toEqual(['src/a.ts', 'src/z.ts'])
  })
})

describe('seedFromScores', () => {
  test('merges scores into the existing baseline preserving untouched keys and taking per-key max', () => {
    const dir = tmpDir()
    const scoresPath = path.join(dir, SCORES_FILE)
    const baselinePath = path.join(dir, 'baseline.json')
    writeJson(scoresPath, { 'src/a.ts': 0.8, 'src/b.ts': 0.4 })
    writeJson(baselinePath, { 'src/a.ts': 0.6, 'src/b.ts': 0.5, 'src/c.ts': 0.1 })

    const count = seedFromScores({ baselinePath, scoresPath, freshBase: undefined, deps: undefined })

    expect(readMap(baselinePath)).toEqual({ 'src/a.ts': 0.8, 'src/b.ts': 0.5, 'src/c.ts': 0.1 })
    expect(count).toBe(3)
  })

  test('creates the baseline file when none exists', () => {
    const dir = tmpDir()
    const scoresPath = path.join(dir, SCORES_FILE)
    const baselinePath = path.join(dir, 'baseline.json')
    writeJson(scoresPath, { 'src/a.ts': 0.5 })

    const count = seedFromScores({ baselinePath, scoresPath, freshBase: undefined, deps: undefined })

    expect(readMap(baselinePath)).toEqual({ 'src/a.ts': 0.5 })
    expect(count).toBe(1)
  })

  test('throws when the scores file does not exist', () => {
    const dir = tmpDir()

    expect(() =>
      seedFromScores({
        baselinePath: path.join(dir, 'baseline.json'),
        scoresPath: path.join(dir, 'missing.json'),
        freshBase: undefined,
        deps: undefined,
      }),
    ).toThrow('does not exist')
  })

  test('does not call git when freshBase is not provided', () => {
    const dir = tmpDir()
    const scoresPath = path.join(dir, SCORES_FILE)
    writeJson(scoresPath, { 'src/a.ts': 0.5 })
    const runGit = mock(() => '')
    const deps: SeedFromDeps = { runGit, log: mock(() => {}) }

    seedFromScores({ baselinePath: path.join(dir, 'baseline.json'), scoresPath, freshBase: undefined, deps })

    expect(runGit).not.toHaveBeenCalled()
  })

  test('excludes scores for files changed since freshBase and logs the exclusion', () => {
    const dir = tmpDir()
    const scoresPath = path.join(dir, SCORES_FILE)
    const baselinePath = path.join(dir, 'baseline.json')
    writeJson(scoresPath, { 'src/a.ts': 0.5, 'src/moved.ts': 0.7 })
    writeJson(baselinePath, { 'src/untouched.ts': 0.9 })
    const runGit = mock(() => 'src/moved.ts\nCHANGELOG.md\n')
    const logs: string[] = []
    const deps: SeedFromDeps = {
      runGit,
      log: (message) => {
        logs.push(message)
      },
    }

    const count = seedFromScores({ baselinePath, scoresPath, freshBase: 'abc123', deps })

    expect(runGit).toHaveBeenCalledWith(['diff', '--name-only', 'abc123', 'HEAD'])
    expect(readMap(baselinePath)).toEqual({ 'src/a.ts': 0.5, 'src/untouched.ts': 0.9 })
    expect(count).toBe(2)
    expect(logs.some((message) => message.includes('src/moved.ts'))).toBe(true)
  })

  test('seeds every score when the fresh-base diff is empty', () => {
    const dir = tmpDir()
    const scoresPath = path.join(dir, SCORES_FILE)
    const baselinePath = path.join(dir, 'baseline.json')
    writeJson(scoresPath, { 'src/a.ts': 0.5, 'src/b.ts': 0.7 })
    const deps: SeedFromDeps = { runGit: mock(() => ''), log: mock(() => {}) }

    const count = seedFromScores({ baselinePath, scoresPath, freshBase: 'abc123', deps })

    expect(readMap(baselinePath)).toEqual({ 'src/a.ts': 0.5, 'src/b.ts': 0.7 })
    expect(count).toBe(2)
  })
})
