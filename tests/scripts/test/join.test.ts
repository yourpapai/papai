// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'

import { segmentLog } from '../../../scripts/test/console-log.js'
import type { LogFailureBlock, LogSegment } from '../../../scripts/test/console-log.js'
import { joinFailures } from '../../../scripts/test/join.js'
import type { JoinedFailure } from '../../../scripts/test/join.js'
import { parseJUnit } from '../../../scripts/test/junit.js'
import type { JUnitRun } from '../../../scripts/test/junit.js'

const FIXTURES = joinPath(import.meta.dir, 'fixtures')
const CWD = '/home/user/papai'

const readFixture = (name: string): string => readFileSync(joinPath(FIXTURES, name), 'utf8')

const NESTED_LOG = readFixture('console-nested.log')
const NESTED_XML = readFixture('junit-nested.xml')
const GREEN_LOG = readFixture('console-green.log')
const GREEN_XML = readFixture('junit-green.xml')

const nested = (): { junit: JUnitRun; segments: LogSegment[] } => ({
  junit: parseJUnit(NESTED_XML, CWD),
  segments: segmentLog(NESTED_LOG, CWD).segments,
})

const emptyJUnit = (): JUnitRun => parseJUnit('', CWD)

const markerOf = (failure: JoinedFailure): string => `(fail) ${[...failure.suite, failure.name].join(' > ')} [`

/** Slices a failure's recorded range back out of the log, or fails loudly if it has none. */
const sliceDetail = (text: string, failure: JoinedFailure | undefined): string => {
  const detail = failure?.detail
  if (detail === undefined || detail === null) throw new Error(`expected a detail range on ${failure?.name ?? '?'}`)
  return text.slice(detail.logOffset, detail.logOffset + detail.logLength)
}

const findLeafX = (failures: readonly JoinedFailure[], suite: string): JoinedFailure | undefined =>
  failures.find((failure) => failure.suite[0] === suite && failure.name === 'x')

/** Rewrites the second block's marker so it no longer matches its junit case. */
const renameSecondBlock = (block: LogFailureBlock, index: number): LogFailureBlock =>
  index === 1 ? { ...block, markerText: 'A > renamed' } : block

describe('joinFailures', () => {
  test('pairs every junit failure with its console diagnostic', () => {
    const { junit, segments } = nested()
    const { failures, joinWarnings } = joinFailures(junit, segments)

    expect(joinWarnings).toEqual([])
    expect(failures.map((failure) => [failure.suite, failure.name])).toEqual([
      [['outer', 'inner'], 'deep fails'],
      [['A'], 'x'],
      [['A'], 'y'],
      [['B'], 'x'],
    ])
    expect(failures.map((failure) => failure.id)).toEqual([1, 2, 3, 4])
    expect(failures.every((failure) => failure.file === 'reports/fixture-gen/nested.test.ts')).toBe(true)
    expect(failures.map((failure) => failure.line)).toEqual([5, 12, 15, 21])
  })

  test('the detail range slices back to that failure and no other', () => {
    const { junit, segments } = nested()
    const { failures } = joinFailures(junit, segments)

    const slices = failures.map((failure) => sliceDetail(NESTED_LOG, failure))

    for (const [index, failure] of failures.entries()) {
      expect(slices[index]).toContain(markerOf(failure))
    }
    expect(slices.map((slice) => slice.endsWith(']'))).toEqual([true, true, true, true])
  })

  test('sibling describes sharing a leaf name keep their own diagnostics', () => {
    // `A > x` and `B > x` differ only in their describe. A name-keyed join would
    // put both on whichever block it saw first; the positional join must not.
    const { junit, segments } = nested()
    const { failures } = joinFailures(junit, segments)

    const fromA = sliceDetail(NESTED_LOG, findLeafX(failures, 'A'))
    const fromB = sliceDetail(NESTED_LOG, findLeafX(failures, 'B'))

    expect(fromA).toContain('Expected: "right"')
    expect(fromB).toContain('B x exploded')
    expect(fromA).not.toContain('B x exploded')
  })

  test('groups by file, so segment order does not matter', () => {
    const { junit, segments } = nested()
    const forward = joinFailures(junit, segments)
    const reversed = joinFailures(junit, [...segments].reverse())

    expect(reversed.failures).toEqual(forward.failures)
    expect(reversed.joinWarnings).toEqual([])
  })

  test('a green run joins to nothing', () => {
    const { failures, joinWarnings } = joinFailures(parseJUnit(GREEN_XML, CWD), segmentLog(GREEN_LOG, CWD).segments)

    expect(failures).toEqual([])
    expect(joinWarnings).toEqual([])
  })

  test('keeps junit identity and drops the range when the pairing disagrees', () => {
    const { junit, segments } = nested()
    const tampered = segments.map((segment) => ({
      ...segment,
      blocks: segment.blocks.map(renameSecondBlock),
    }))

    const { failures, joinWarnings } = joinFailures(junit, tampered)

    expect(failures).toHaveLength(4)
    expect(failures[1]?.name).toBe('x')
    expect(failures[1]?.detail).toBeNull()
    expect(joinWarnings).toHaveLength(1)
    expect(joinWarnings[0]).toContain('reports/fixture-gen/nested.test.ts')
  })

  test('recovers failures from the log alone when junit is missing them', () => {
    // Bun writes no junit file at all when every file fails to load, and omits
    // unloadable files from a mixed document. Dropping the log's own markers
    // because junit forgot them would lose the entire run.
    const { segments } = nested()
    const { failures, joinWarnings } = joinFailures(emptyJUnit(), segments)

    expect(failures.map((failure) => [failure.suite, failure.name])).toEqual([
      [['outer', 'inner'], 'deep fails'],
      [['A'], 'x'],
      [['A'], 'y'],
      [['B'], 'x'],
    ])
    expect(failures.every((failure) => failure.detail !== null)).toBe(true)
    expect(failures.every((failure) => failure.line === null)).toBe(true)
    expect(joinWarnings).toHaveLength(1)
    expect(joinWarnings[0]).toContain('reports/fixture-gen/nested.test.ts')
  })

  test('keeps junit failures that the log never printed', () => {
    const { junit } = nested()
    const { failures, joinWarnings } = joinFailures(junit, [])

    expect(failures).toHaveLength(4)
    expect(failures.every((failure) => failure.detail === null)).toBe(true)
    expect(joinWarnings).toHaveLength(1)
  })

  test('numbers failures from one across every file', () => {
    const { junit, segments } = nested()
    const extraFile = 'tests/other.test.ts'
    const withExtra: LogSegment[] = [
      ...segments,
      { file: extraFile, blocks: [{ markerText: 'solo > boom', ms: 1, offset: 0, length: 4 }] },
    ]

    const { failures } = joinFailures(junit, withExtra)

    expect(failures.map((failure) => failure.id)).toEqual([1, 2, 3, 4, 5])
    expect(failures[4]).toMatchObject({ file: extraFile, suite: ['solo'], name: 'boom' })
  })

  test('treats a marker with no describe as a bare test name', () => {
    const segments: LogSegment[] = [
      { file: 'tests/bare.test.ts', blocks: [{ markerText: 'just a name', ms: 2, offset: 0, length: 3 }] },
    ]

    const { failures } = joinFailures(emptyJUnit(), segments)

    expect(failures[0]).toMatchObject({ suite: [], name: 'just a name' })
  })

  test('ignores log output printed before any file header', () => {
    const segments: LogSegment[] = [
      { file: null, blocks: [{ markerText: 'orphan > case', ms: 1, offset: 0, length: 2 }] },
    ]

    const { failures, joinWarnings } = joinFailures(emptyJUnit(), segments)

    expect(failures).toEqual([])
    expect(joinWarnings).toEqual([])
  })
})
