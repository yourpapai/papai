// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parsePairedRunCliArgs } from '../../../scripts/mutation/paired-run-cli.js'

describe('parsePairedRunCliArgs --update-baseline', () => {
  test('parses --update-baseline alongside --threshold= and source files', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold=0.75', '--update-baseline'])).toEqual({
      kind: 'ok',
      sourceFiles: ['src/foo.ts'],
      threshold: 0.75,
      updateBaseline: true,
      verbose: false,
    })
  })

  test('parses --update-baseline without a threshold', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--update-baseline'])).toEqual({
      kind: 'ok',
      sourceFiles: ['src/foo.ts'],
      threshold: 0,
      updateBaseline: true,
      verbose: false,
    })
  })

  test('defaults updateBaseline to false when the flag is absent', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold=0.75'])).toEqual({
      kind: 'ok',
      sourceFiles: ['src/foo.ts'],
      threshold: 0.75,
      updateBaseline: false,
      verbose: false,
    })
  })
})
