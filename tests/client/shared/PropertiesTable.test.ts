// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('PropertiesTable.svelte', () => {
  test('source contains scoped styles for tree-container and tree-key-cell', async () => {
    const url = new URL('../../../client/shared/PropertiesTable.svelte', import.meta.url)
    const source = await Bun.file(url).text()
    const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/u)
    expect(styleMatch).not.toBeNull()
    const css = styleMatch![1]
    expect(css).toContain('.tree-container')
    expect(css).toContain('.tree-key-cell')
    expect(css).toContain('.tree-value-cell')
  })
})
