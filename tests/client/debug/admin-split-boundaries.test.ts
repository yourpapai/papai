// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('debug/admin split boundaries', () => {
  test('legacy debug entry wrapper was removed after direct DebugApp mount', async () => {
    expect(await Bun.file('client/debug/App.svelte').exists()).toBe(false)
  })

  test('legacy debug-only admin panels were removed after admin split', async () => {
    expect(await Bun.file('client/debug/components/RemindersPanel.svelte').exists()).toBe(false)
    expect(await Bun.file('client/debug/components/MemosPanel.svelte').exists()).toBe(false)
    expect(await Bun.file('client/debug/components/ContextPanel.svelte').exists()).toBe(false)
  })

  test('temporary admin extras holding pen was removed', async () => {
    expect(await Bun.file('client/admin/handlers-admin-extras.ts').exists()).toBe(false)
  })

  test('debug no longer owns stats UI or stats fetchers after task 10', async () => {
    expect(await Bun.file('client/debug/stats/StatsPanel.svelte').exists()).toBe(false)
    expect(await Bun.file('client/debug/stats/SubjectStatsPanel.svelte').exists()).toBe(false)
    expect(await Bun.file('client/debug/stats/fetchers.ts').exists()).toBe(false)
  })
})
