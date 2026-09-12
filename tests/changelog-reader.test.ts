// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { readChangelogFile, type ReadChangelogText } from '../src/changelog-reader.js'

describe('readChangelogFile', () => {
  test('delegates to the injected reader with the changelog URL', async () => {
    const calls: URL[] = []
    const reader: ReadChangelogText = (url) => {
      calls.push(url)
      return Promise.resolve('## injected changelog body')
    }

    const result = await readChangelogFile(reader)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.pathname.endsWith('/CHANGELOG.md')).toBe(true)
    expect(result).toBe('## injected changelog body')
  })

  test('returns the reader output verbatim', async () => {
    const result = await readChangelogFile(() => Promise.resolve('raw-bytes'))

    expect(result).toBe('raw-bytes')
  })
})
