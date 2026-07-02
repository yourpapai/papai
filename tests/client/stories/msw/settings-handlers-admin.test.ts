// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  adminCodingGuardrailsHandlers,
  adminInstancesHandlers,
  adminReleaseNotesHandlers,
} from '../../../../client/stories/msw/settings-handlers-admin-2.js'
import {
  adminAdminsHandlers,
  adminByokHandlers,
  adminGroupsHandlers,
  adminPluginConfigHandlers,
  adminSystemHandlers,
  adminToolDefaultsHandlers,
} from '../../../../client/stories/msw/settings-handlers-admin.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

function assertHandlerFamily(
  name: string,
  family: { populated: HttpHandler[]; empty: HttpHandler[]; error: HttpHandler[]; loading: HttpHandler[] },
  expectedPath: string,
): void {
  test(`${name} has all four variants with at least one handler each`, () => {
    expect(Array.isArray(family.populated)).toBe(true)
    expect(Array.isArray(family.empty)).toBe(true)
    expect(Array.isArray(family.error)).toBe(true)
    expect(Array.isArray(family.loading)).toBe(true)
    expect(family.populated.length).toBeGreaterThan(0)
  })

  test(`${name} populated covers ${expectedPath}`, () => {
    expect(pathsOf(family.populated).some((p) => p.includes(expectedPath))).toBe(true)
  })

  test(`${name} error covers ${expectedPath}`, () => {
    expect(pathsOf(family.error).some((p) => p.includes(expectedPath))).toBe(true)
  })

  test(`${name} loading covers ${expectedPath}`, () => {
    expect(pathsOf(family.loading).some((p) => p.includes(expectedPath))).toBe(true)
  })
}

describe('admin settings msw handlers', () => {
  assertHandlerFamily('adminByokHandlers', adminByokHandlers, '/settings/api/admin/byok')
  assertHandlerFamily('adminSystemHandlers', adminSystemHandlers, '/settings/api/admin/system')
  assertHandlerFamily('adminGroupsHandlers', adminGroupsHandlers, '/settings/api/admin/groups')
  assertHandlerFamily('adminAdminsHandlers', adminAdminsHandlers, '/settings/api/admin/admins')
  assertHandlerFamily('adminPluginConfigHandlers', adminPluginConfigHandlers, '/settings/api/admin/plugin-config')
  assertHandlerFamily('adminToolDefaultsHandlers', adminToolDefaultsHandlers, '/settings/api/admin/tool-defaults')
  assertHandlerFamily('adminReleaseNotesHandlers', adminReleaseNotesHandlers, '/settings/api/admin/release-notes')
  assertHandlerFamily(
    'adminCodingGuardrailsHandlers',
    adminCodingGuardrailsHandlers,
    '/settings/api/admin/coding-guardrails',
  )

  // adminInstancesHandlers mocks four endpoints in populated/empty
  test('adminInstancesHandlers has all four variants', () => {
    expect(Array.isArray(adminInstancesHandlers.populated)).toBe(true)
    expect(Array.isArray(adminInstancesHandlers.empty)).toBe(true)
    expect(Array.isArray(adminInstancesHandlers.error)).toBe(true)
    expect(Array.isArray(adminInstancesHandlers.loading)).toBe(true)
    expect(adminInstancesHandlers.populated.length).toBeGreaterThan(0)
  })

  test('adminInstancesHandlers populated covers all four instance endpoints', () => {
    const paths = pathsOf(adminInstancesHandlers.populated)
    expect(paths.some((p) => p.includes('/settings/api/admin/platform-instances'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/admin/task-instances'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/admin/platform-provider-types'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/admin/task-provider-types'))).toBe(true)
  })

  test('adminInstancesHandlers error covers platform-instances', () => {
    expect(
      pathsOf(adminInstancesHandlers.error).some((p) => p.includes('/settings/api/admin/platform-instances')),
    ).toBe(true)
  })
})
