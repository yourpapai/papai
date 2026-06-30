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

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('admin settings msw handlers (part 2)', () => {
  test('adminReleaseNotesHandlers has all four variants', () => {
    expect(Array.isArray(adminReleaseNotesHandlers.populated)).toBe(true)
    expect(Array.isArray(adminReleaseNotesHandlers.empty)).toBe(true)
    expect(Array.isArray(adminReleaseNotesHandlers.error)).toBe(true)
    expect(Array.isArray(adminReleaseNotesHandlers.loading)).toBe(true)
    expect(adminReleaseNotesHandlers.populated.length).toBeGreaterThan(0)
  })

  test('adminReleaseNotesHandlers populated covers /settings/api/admin/release-notes', () => {
    expect(
      pathsOf(adminReleaseNotesHandlers.populated).some((p) => p.includes('/settings/api/admin/release-notes')),
    ).toBe(true)
  })

  test('adminCodingGuardrailsHandlers has all four variants', () => {
    expect(Array.isArray(adminCodingGuardrailsHandlers.populated)).toBe(true)
    expect(Array.isArray(adminCodingGuardrailsHandlers.empty)).toBe(true)
    expect(Array.isArray(adminCodingGuardrailsHandlers.error)).toBe(true)
    expect(Array.isArray(adminCodingGuardrailsHandlers.loading)).toBe(true)
    expect(adminCodingGuardrailsHandlers.populated.length).toBeGreaterThan(0)
  })

  test('adminCodingGuardrailsHandlers populated covers /settings/api/admin/coding-guardrails', () => {
    expect(
      pathsOf(adminCodingGuardrailsHandlers.populated).some((p) => p.includes('/settings/api/admin/coding-guardrails')),
    ).toBe(true)
  })

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
