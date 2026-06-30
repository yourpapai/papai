// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  adminUsersHandlers,
  byokHandlers,
  kaneoHandlers,
  reposHandlers,
  shellReadyHandlers,
} from '../../../../client/stories/msw/settings-handlers.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('settings msw handlers', () => {
  test('reposHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(reposHandlers.populated)).toBe(true)
    expect(Array.isArray(reposHandlers.empty)).toBe(true)
    expect(Array.isArray(reposHandlers.error)).toBe(true)
    expect(Array.isArray(reposHandlers.loading)).toBe(true)
    expect(reposHandlers.populated.length).toBeGreaterThan(0)
  })

  test('reposHandlers populated covers /settings/api/coding-repos', () => {
    expect(pathsOf(reposHandlers.populated).some((p) => p.includes('/settings/api/coding-repos'))).toBe(true)
  })

  test('byokHandlers has secretSet / missing / disabled / error / loading', () => {
    expect(Array.isArray(byokHandlers.secretSet)).toBe(true)
    expect(Array.isArray(byokHandlers.missing)).toBe(true)
    expect(Array.isArray(byokHandlers.disabled)).toBe(true)
    expect(Array.isArray(byokHandlers.error)).toBe(true)
    expect(Array.isArray(byokHandlers.loading)).toBe(true)
  })

  test('byokHandlers secretSet covers /settings/api/byok', () => {
    expect(pathsOf(byokHandlers.secretSet).some((p) => p.includes('/settings/api/byok'))).toBe(true)
  })

  test('kaneoHandlers has populated / notProvisioned / error / loading', () => {
    expect(Array.isArray(kaneoHandlers.populated)).toBe(true)
    expect(Array.isArray(kaneoHandlers.notProvisioned)).toBe(true)
    expect(Array.isArray(kaneoHandlers.error)).toBe(true)
    expect(Array.isArray(kaneoHandlers.loading)).toBe(true)
  })

  test('kaneoHandlers populated covers /settings/api/kaneo/credentials', () => {
    expect(pathsOf(kaneoHandlers.populated).some((p) => p.includes('/settings/api/kaneo/credentials'))).toBe(true)
  })

  test('adminUsersHandlers has all four variants', () => {
    expect(Array.isArray(adminUsersHandlers.populated)).toBe(true)
    expect(Array.isArray(adminUsersHandlers.empty)).toBe(true)
    expect(Array.isArray(adminUsersHandlers.error)).toBe(true)
    expect(Array.isArray(adminUsersHandlers.loading)).toBe(true)
    expect(adminUsersHandlers.populated.length).toBeGreaterThan(0)
  })

  test('adminUsersHandlers populated covers /settings/api/admin/users', () => {
    expect(pathsOf(adminUsersHandlers.populated).some((p) => p.includes('/settings/api/admin/users'))).toBe(true)
  })

  test('shellReadyHandlers is a non-empty array covering core shell routes', () => {
    expect(Array.isArray(shellReadyHandlers)).toBe(true)
    expect(shellReadyHandlers.length).toBeGreaterThan(0)
    const paths = pathsOf(shellReadyHandlers)
    expect(paths.some((p) => p.includes('/settings/api/config'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/tools'))).toBe(true)
  })
})
