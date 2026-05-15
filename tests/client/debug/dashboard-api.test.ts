// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeAll, describe, expect, test } from 'bun:test'

// Load the dashboard HTML into the happy-dom document *before* importing
// the dashboard-api module, which wires DOM listeners at module load time.
beforeAll(async () => {
  const html = await Bun.file('client/debug/dashboard.html').text()
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html)
  if (bodyMatch !== null) {
    document.body.innerHTML = bodyMatch[1] ?? ''
  }
  // Side-effect import: registers window.dashboard and wires listeners
  await import('../../../client/debug/dashboard-api.js')
})

describe('dashboard-api', () => {
  test('registers window.dashboard global with expected shape', () => {
    expect(typeof window.dashboard).toBe('object')
    expect(window.dashboard.__state).toBeDefined()
    expect(window.dashboard.__state.connected).toBe(false)
    expect(window.dashboard.__state.sessions).toBeInstanceOf(Map)
    expect(window.dashboard.__state.logs).toEqual([])
    expect(typeof window.dashboard.renderConnection).toBe('function')
    expect(typeof window.dashboard.renderStats).toBe('function')
    expect(typeof window.dashboard.renderLogs).toBe('function')
  })
})
