// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  pluginsConfigurableHandlers,
  pluginsIneligibleHandlers,
} from '../../../../client/stories/msw/settings-handlers-plugins.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('settings plugins msw handlers', () => {
  test('pluginsConfigurableHandlers covers /settings/api/plugins', () => {
    expect(Array.isArray(pluginsConfigurableHandlers)).toBe(true)
    expect(pluginsConfigurableHandlers.length).toBeGreaterThan(0)
    const paths = pathsOf(pluginsConfigurableHandlers)
    expect(paths.some((p) => p.includes('/settings/api/plugins'))).toBe(true)
  })

  test('pluginsIneligibleHandlers covers /settings/api/plugins', () => {
    expect(Array.isArray(pluginsIneligibleHandlers)).toBe(true)
    expect(pluginsIneligibleHandlers.length).toBeGreaterThan(0)
    const paths = pathsOf(pluginsIneligibleHandlers)
    expect(paths.some((p) => p.includes('/settings/api/plugins'))).toBe(true)
  })
})
