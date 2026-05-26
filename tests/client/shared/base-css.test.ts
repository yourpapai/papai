// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('base.css', () => {
  test('defines status-success class', async () => {
    const url = new URL('../../../client/shared/base.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.status-success')
    expect(css).toMatch(/\.status-success[^{]*\{[^}]*color:\s*var\(--accent\)/u)
  })

  test('defines truncation-banner class', async () => {
    const url = new URL('../../../client/shared/base.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.truncation-banner')
  })
})
