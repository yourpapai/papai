// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('admin.css', () => {
  test('defines masked-value class', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.masked-value')
  })

  test('defines masked-hint class', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.masked-hint')
  })
})
