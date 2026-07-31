// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  adminAnalyticsFailedSinkHandlers,
  adminAnalyticsGovernedLocalPilotHandlers,
  adminAnalyticsHandlers,
  adminAnalyticsIncompleteGovernanceHandlers,
  adminAnalyticsKillSwitchHandlers,
  adminAnalyticsReconciledHealthyHandlers,
} from '../../../../client/stories/msw/settings-handlers-admin-3.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('admin settings msw handlers (part 3: analytics)', () => {
  test('adminAnalyticsHandlers has all four variants', () => {
    expect(Array.isArray(adminAnalyticsHandlers.populated)).toBe(true)
    expect(Array.isArray(adminAnalyticsHandlers.empty)).toBe(true)
    expect(Array.isArray(adminAnalyticsHandlers.error)).toBe(true)
    expect(Array.isArray(adminAnalyticsHandlers.loading)).toBe(true)
    expect(adminAnalyticsHandlers.populated.length).toBeGreaterThan(0)
  })

  test('adminAnalyticsHandlers populated covers GET/PATCH analytics and POST reconcile', () => {
    const paths = pathsOf(adminAnalyticsHandlers.populated)
    expect(paths.some((p) => p.includes('/settings/api/admin/analytics'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/admin/analytics/reconcile'))).toBe(true)
  })

  test('adminAnalyticsHandlers empty serves incomplete governance view', () => {
    const paths = pathsOf(adminAnalyticsHandlers.empty)
    expect(paths.some((p) => p.includes('/settings/api/admin/analytics'))).toBe(true)
  })

  test('named scenario handler arrays cover the analytics view endpoint', () => {
    const families = [
      adminAnalyticsIncompleteGovernanceHandlers,
      adminAnalyticsGovernedLocalPilotHandlers,
      adminAnalyticsKillSwitchHandlers,
      adminAnalyticsFailedSinkHandlers,
      adminAnalyticsReconciledHealthyHandlers,
    ]
    for (const handlers of families) {
      expect(pathsOf(handlers).some((p) => p.includes('/settings/api/admin/analytics'))).toBe(true)
    }
  })

  test('adminAnalyticsFailedSinkHandlers covers the verify endpoint', () => {
    const paths = pathsOf(adminAnalyticsFailedSinkHandlers)
    expect(paths.some((p) => p.includes('/settings/api/admin/analytics/sinks/'))).toBe(true)
  })

  test('adminAnalyticsReconciledHealthyHandlers covers the reconcile endpoint', () => {
    const paths = pathsOf(adminAnalyticsReconciledHealthyHandlers)
    expect(paths.some((p) => p.includes('/settings/api/admin/analytics/reconcile'))).toBe(true)
  })
})
