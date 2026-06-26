// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  billingHandlers,
  identityMappingsHandlers,
  instancesHandlers,
  pluginConfigHandlers,
  statsHandlers,
} from '../../../../client/stories/msw/handlers.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('msw handlers', () => {
  test('every non-empty family exposes populated / empty / error / loading variants', () => {
    for (const family of [
      billingHandlers,
      statsHandlers,
      pluginConfigHandlers,
      instancesHandlers,
      identityMappingsHandlers,
    ]) {
      expect(Array.isArray(family.populated)).toBe(true)
      expect(Array.isArray(family.empty)).toBe(true)
      expect(Array.isArray(family.error)).toBe(true)
      expect(Array.isArray(family.loading)).toBe(true)
      expect(family.populated.length).toBeGreaterThan(0)
    }
  })

  test('billing populated handlers cover the /billing/subjects route', () => {
    expect(pathsOf(billingHandlers.populated).some((p) => p.includes('/billing/subjects'))).toBe(true)
  })

  test('stats populated handlers cover /stats/global', () => {
    expect(pathsOf(statsHandlers.populated).some((p) => p.includes('/stats/global'))).toBe(true)
  })

  test('pluginConfigHandlers populated handlers cover /admin/plugin-config', () => {
    expect(pathsOf(pluginConfigHandlers.populated).some((p) => p.includes('/admin/plugin-config'))).toBe(true)
  })

  test('instancesHandlers populated handlers cover platform and task instance routes', () => {
    const paths = pathsOf(instancesHandlers.populated)
    expect(paths.some((p) => p.includes('/api/platform-instances'))).toBe(true)
    expect(paths.some((p) => p.includes('/api/task-instances'))).toBe(true)
    expect(paths.some((p) => p.includes('/api/admins'))).toBe(true)
  })

  test('identityMappingsHandlers populated handlers cover /admin/identity/mappings', () => {
    expect(pathsOf(identityMappingsHandlers.populated).some((p) => p.includes('/admin/identity/mappings'))).toBe(true)
  })
})
