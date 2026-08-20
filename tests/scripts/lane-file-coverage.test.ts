// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assertCoveredSourceFiles, coveredSourceFiles } from '../../scripts/coverage/lane-file-coverage.js'

const lcov = `SF:src/a.ts\nLF:2\nLH:1\nend_of_record\nSF:src/b.ts\nLF:3\nLH:0\nend_of_record\n`

describe('lane file coverage', () => {
  test('maps each lcov source record to covered lines', () => {
    expect(coveredSourceFiles(lcov)).toEqual(
      new Map([
        ['src/a.ts', 1],
        ['src/b.ts', 0],
      ]),
    )
  })

  test('rejects both missing and zero-covered required files', () => {
    expect(() => assertCoveredSourceFiles(lcov, ['src/a.ts', 'src/b.ts', 'src/c.ts'])).toThrow(
      'Expected non-zero line coverage: src/b.ts, src/c.ts',
    )
  })
})
