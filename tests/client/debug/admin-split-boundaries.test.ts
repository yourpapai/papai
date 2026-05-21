// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

const files = [
  'client/debug/stats/StatsPanel.svelte',
  'client/debug/components/RemindersPanel.svelte',
  'client/debug/components/MemosPanel.svelte',
  'client/debug/components/ContextPanel.svelte',
] as const

describe('debug/admin split boundaries', () => {
  test('legacy admin and backstage components do not type props with debug DashboardState', async () => {
    for (const file of files) {
      const source = await Bun.file(file).text()
      expect(source).not.toContain('DashboardState')
    }
  })

  test('admin handler holding pen does not import debug helpers', async () => {
    const source = await Bun.file('client/admin/handlers-admin-extras.ts').text()
    expect(source).not.toContain('../debug/handlers-helpers.js')
  })
})
