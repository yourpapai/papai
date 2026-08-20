// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { segmentLog } from '../../../scripts/test/console-log.js'
import type { LogFailureBlock } from '../../../scripts/test/console-log.js'

const CWD = '/home/user/papai'

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8')
}

/** Blocks of the first file section — helpers keep branching out of the tests. */
function blocksOf(text: string): LogFailureBlock[] {
  const segment = segmentLog(text, CWD).segments[0]
  if (segment === undefined) throw new Error('log produced no segment')
  return segment.blocks
}

function blockAt(text: string, index: number): LogFailureBlock {
  const block = blocksOf(text)[index]
  if (block === undefined) throw new Error(`log produced no block at ${index}`)
  return block
}

/** Round-trips a block's range back through the original text. */
function sliceBlock(text: string, index: number): string {
  const block = blockAt(text, index)
  return text.slice(block.offset, block.offset + block.length)
}

/** Characters between the end of each block and the start of the next one. */
function blockGaps(text: string): number[] {
  const blocks = blocksOf(text)
  return blocks.slice(1).map((block, index) => {
    const previous = blocks[index]
    if (previous === undefined) throw new Error(`log produced no block at ${index}`)
    return block.offset - (previous.offset + previous.length)
  })
}

const NESTED = fixture('console-nested.log')
const GREEN = fixture('console-green.log')
const MIXED = fixture('console-mixed.log')
const UNHANDLED = fixture('console-unhandled.log')

/** The exact bytes Bun printed for the `B > x` diagnostic, marker line included. */
const B_X_BLOCK = [
  '17 |   })',
  '18 | })',
  '19 | ',
  "20 | describe('B', () => {",
  "21 |   test('x', () => {",
  "22 |     throw new Error('B x exploded')",
  `${' '.repeat(39)}^`,
  'error: B x exploded',
  '      at <anonymous> (/home/user/papai/reports/fixture-gen/nested.test.ts:22:35)',
  '(fail) B > x [0.13ms]',
].join('\n')

/** The `A > x` diagnostic: the first of two sibling describes sharing a leaf name. */
const A_X_BLOCK = [
  ' 8 |   })',
  ' 9 | })',
  '10 | ',
  "11 | describe('A', () => {",
  "12 |   test('x', () => {",
  "13 |     expect('left').toBe('right')",
  `${' '.repeat(24)}^`,
  'error: expect(received).toBe(expected)',
  '',
  'Expected: "right"',
  'Received: "left"',
  '',
  '      at <anonymous> (/home/user/papai/reports/fixture-gen/nested.test.ts:13:20)',
  '(fail) A > x [0.26ms]',
].join('\n')

const UNHANDLED_MESSAGE =
  "error: Cannot find module './definitely-not-a-real-module.js' from " +
  "'/home/user/papai/reports/fixture-gen/unhandled.test.ts'"

describe('segmentLog — nested failure fixture', () => {
  test('groups every failure block under its file header', () => {
    const result = segmentLog(NESTED, CWD)

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]?.file).toBe('reports/fixture-gen/nested.test.ts')
    expect(result.segments[0]?.blocks.map((block) => block.markerText)).toEqual([
      'outer > inner > deep fails',
      'A > x',
      'A > y',
      'B > x',
    ])
  })

  test('reads the marker duration in milliseconds', () => {
    const result = segmentLog(NESTED, CWD)

    expect(result.segments[0]?.blocks.map((block) => block.ms)).toEqual([2.45, 0.26, 0.3, 0.13])
  })

  test('offset/length slice back to the exact diagnostic block', () => {
    expect(sliceBlock(NESTED, 1)).toBe(A_X_BLOCK)
    expect(sliceBlock(NESTED, 3)).toBe(B_X_BLOCK)
  })

  test('the first block starts right after the file header line', () => {
    const text = sliceBlock(NESTED, 0)

    expect(text.startsWith("1 | import { describe, expect, test } from 'bun:test'\n")).toBe(true)
    expect(text.endsWith('(fail) outer > inner > deep fails [2.45ms]')).toBe(true)
  })

  test('blocks tile the section, separated only by the marker newline', () => {
    expect(blockGaps(NESTED)).toEqual([1, 1, 1])
  })

  test('parses the trailing summary and reports no run errors', () => {
    const result = segmentLog(NESTED, CWD)

    expect(result.summary).toEqual({ files: 1, tests: 5, pass: 1, fail: 4, skip: 0, expects: 4 })
    expect(result.runErrors).toEqual([])
  })
})

describe('segmentLog — green fixture', () => {
  test('yields no segments and no blocks', () => {
    const result = segmentLog(GREEN, CWD)

    expect(result.segments).toEqual([])
    expect(result.runErrors).toEqual([])
  })

  test('still parses the summary counts', () => {
    expect(segmentLog(GREEN, CWD).summary).toEqual({
      files: 1,
      tests: 2,
      pass: 2,
      fail: 0,
      skip: 0,
      expects: 2,
    })
  })
})

describe('segmentLog — mixed fixture (JUnit says failures="0")', () => {
  test('summary is the trustworthy source of the failure count', () => {
    expect(segmentLog(MIXED, CWD).summary).toEqual({
      files: 2,
      tests: 3,
      pass: 2,
      fail: 1,
      skip: 0,
      expects: 2,
    })
  })

  test('the load error becomes a run error attributed to its file', () => {
    const result = segmentLog(MIXED, CWD)

    expect(result.runErrors).toEqual([{ file: 'reports/fixture-gen/unhandled.test.ts', message: UNHANDLED_MESSAGE }])
  })

  test('the unloadable file still yields a segment with zero blocks', () => {
    const result = segmentLog(MIXED, CWD)

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]?.file).toBe('reports/fixture-gen/unhandled.test.ts')
    expect(result.segments[0]?.blocks).toEqual([])
  })
})

describe('segmentLog — unhandled fixture (no JUnit written)', () => {
  test('the run error is the only failure evidence', () => {
    const result = segmentLog(UNHANDLED, CWD)

    expect(result.runErrors).toEqual([{ file: 'reports/fixture-gen/unhandled.test.ts', message: UNHANDLED_MESSAGE }])
    expect(result.segments[0]?.blocks).toEqual([])
  })

  test('parses the singular "Ran 1 test across 1 file." summary', () => {
    expect(segmentLog(UNHANDLED, CWD).summary).toEqual({
      files: 1,
      tests: 1,
      pass: 0,
      fail: 1,
      skip: 0,
      expects: 0,
    })
  })
})

describe('segmentLog — file header normalization', () => {
  test('keeps an out-of-tree header relative to cwd', () => {
    const text = ['../../tmp/out-of-tree.test.ts:', '1 | boom', '(fail) alpha [1.00ms]', ''].join('\n')

    expect(segmentLog(text, CWD).segments[0]?.file).toBe('../../tmp/out-of-tree.test.ts')
  })

  test('rewrites an absolute in-tree header to repo-relative', () => {
    const text = [`${CWD}/src/thing.test.ts:`, '1 | boom', '(fail) alpha [1.00ms]', ''].join('\n')

    expect(segmentLog(text, CWD).segments[0]?.file).toBe('src/thing.test.ts')
  })

  test('does not treat diagnostic lines ending in a colon as headers', () => {
    const text = [
      'src/a.test.ts:',
      'error: expect(received).toBe(expected)',
      'Expected:',
      '(fail) alpha [1.00ms]',
      '',
    ].join('\n')

    const result = segmentLog(text, CWD)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]?.file).toBe('src/a.test.ts')
  })
})

describe('segmentLog — edge cases', () => {
  test('output before any file header lands in a null-file segment', () => {
    const text = ['1 | boom', '(fail) orphan [1.00ms]', ''].join('\n')

    const result = segmentLog(text, CWD)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]?.file).toBeNull()
    expect(result.segments[0]?.blocks[0]?.markerText).toBe('orphan')
  })

  test('an unhandled error before any file header has a null file', () => {
    const text = [
      '# Unhandled error between tests',
      '-------------------------------',
      'error: nope',
      '-------------------------------',
      '',
    ].join('\n')

    expect(segmentLog(text, CWD).runErrors).toEqual([{ file: null, message: 'error: nope' }])
  })

  test('a non-failing marker also closes the preceding block', () => {
    const text = ['src/a.test.ts:', '(pass) alpha [1.00ms]', 'noise for beta', '(fail) beta [2.00ms]', ''].join('\n')

    expect(sliceBlock(text, 0)).toBe('noise for beta\n(fail) beta [2.00ms]')
  })

  test('converts a seconds-formatted marker duration to milliseconds', () => {
    const text = ['src/a.test.ts:', 'boom', '(fail) slow one [1.50s]', ''].join('\n')

    expect(segmentLog(text, CWD).segments[0]?.blocks[0]?.ms).toBe(1500)
  })

  test('parses a skip count', () => {
    const text = [
      ' 1 pass',
      ' 3 skip',
      ' 0 fail',
      ' 1 expect() calls',
      'Ran 4 tests across 2 files. [12.00ms]',
      '',
    ].join('\n')

    expect(segmentLog(text, CWD).summary).toEqual({
      files: 2,
      tests: 4,
      pass: 1,
      fail: 0,
      skip: 3,
      expects: 1,
    })
  })

  test('returns a null summary when the run printed no totals', () => {
    const text = ['src/a.test.ts:', 'boom', '(fail) alpha [1.00ms]', ''].join('\n')

    expect(segmentLog(text, CWD).summary).toBeNull()
  })

  test('an empty log yields nothing at all', () => {
    expect(segmentLog('', CWD)).toEqual({ segments: [], runErrors: [], summary: null })
  })

  test('ignores count lines that are not adjacent to the "Ran" line', () => {
    const text = [
      'src/a.test.ts:',
      ' 9 pass',
      'boom',
      '(fail) alpha [1.00ms]',
      '',
      ' 1 pass',
      ' 1 fail',
      'Ran 2 tests across 1 file. [5.00ms]',
      '',
    ].join('\n')

    expect(segmentLog(text, CWD).summary?.pass).toBe(1)
  })
})
