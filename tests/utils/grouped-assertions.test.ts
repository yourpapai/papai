// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assertEach } from './grouped-assertions.js'

type CaseRow = { label: string; input: string; expected: string }

const toUpper = (value: string): string => value.toUpperCase()

const throwingRun = (row: CaseRow): void => {
  if (row.label === 'throwing-row') throw new Error('boom: fixture exploded')
  expect(toUpper(row.input)).toBe(row.expected)
}

async function captureError(fn: () => Promise<void>): Promise<Error> {
  try {
    await fn()
  } catch (thrown) {
    if (thrown instanceof Error) return thrown
    return new Error(`non-Error thrown: ${String(thrown)}`)
  }
  throw new Error('expected assertEach to reject, but it resolved')
}

describe('assertEach', () => {
  test('resolves without throwing when every row passes (zero-failure pass-through)', async () => {
    const rows: readonly CaseRow[] = [
      { label: 'uppercases a', input: 'a', expected: 'A' },
      { label: 'uppercases b', input: 'b', expected: 'B' },
      { label: 'passes a non-letter through', input: '7', expected: '7' },
    ]
    await assertEach(rows, (row) => {
      expect(toUpper(row.input)).toBe(row.expected)
    })
  })

  test('aggregates every failed row with its label, row data, and the matcher Expected/Received text', async () => {
    const rows: readonly CaseRow[] = [
      { label: 'first-passes', input: 'a', expected: 'A' },
      { label: 'second-fails', input: 'b', expected: 'X' },
      { label: 'third-fails', input: 'c', expected: 'Y' },
    ]
    const error = await captureError(() =>
      assertEach(rows, (row) => {
        expect(toUpper(row.input)).toBe(row.expected)
      }),
    )
    const message = error.message
    expect(message).toContain('second-fails')
    expect(message).toContain('third-fails')
    expect(message).toContain('"input":"b"')
    expect(message).toContain('"expected":"X"')
    expect(message).toContain('"input":"c"')
    expect(message).toContain('"expected":"Y"')
    expect(message).toContain('Expected: "X"')
    expect(message).toContain('Received: "B"')
    expect(message).toContain('Expected: "Y"')
    expect(message).toContain('Received: "C"')
  })

  test('a failing row at position k is identified by its own label, not the first row and not the group', async () => {
    const rows: readonly CaseRow[] = [
      { label: 'row-one-passes', input: 'a', expected: 'A' },
      { label: 'row-two-passes', input: 'b', expected: 'B' },
      { label: 'row-three-fails', input: 'c', expected: 'WRONG' },
    ]
    const error = await captureError(() =>
      assertEach(rows, (row) => {
        expect(toUpper(row.input)).toBe(row.expected)
      }),
    )
    expect(error.message).toContain('row-three-fails')
    expect(error.message).not.toContain('row-one-passes')
    expect(error.message).not.toContain('row-two-passes')
    expect(error.message).toContain('Expected: "WRONG"')
    expect(error.message).toContain('Received: "C"')
  })

  test('async rows are awaited sequentially before the next row starts', async () => {
    const order: string[] = []
    const rows: readonly (CaseRow & { readonly delay: number })[] = [
      { label: 'slow-a', input: 'a', expected: 'A', delay: 20 },
      { label: 'slow-b', input: 'b', expected: 'B', delay: 1 },
      { label: 'slow-c', input: 'c', expected: 'C', delay: 1 },
    ]
    await assertEach(rows, async (row) => {
      order.push(`${row.label}:start`)
      await new Promise((resolve) => {
        setTimeout(resolve, row.delay)
      })
      order.push(`${row.label}:end`)
      expect(toUpper(row.input)).toBe(row.expected)
    })
    expect(order).toEqual(['slow-a:start', 'slow-a:end', 'slow-b:start', 'slow-b:end', 'slow-c:start', 'slow-c:end'])
  })

  test('a non-assertion throw inside a row is re-reported with its row label, never swallowed', async () => {
    const rows: readonly CaseRow[] = [
      { label: 'ok-row', input: 'a', expected: 'A' },
      { label: 'throwing-row', input: 'b', expected: 'B' },
    ]
    const error = await captureError(() => assertEach(rows, throwingRun))
    expect(error.message).toContain('throwing-row')
    expect(error.message).toContain('boom: fixture exploded')
  })
})
