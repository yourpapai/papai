// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { HttpHandler } from 'msw'

import {
  analyticsPreferencesHandlers,
  analyticsWithdrawalInProgressHandlers,
  configHandlers,
  releaseSubscriptionHandlers,
  releaseSubscriptionMutatingHandlers,
  releaseSubscriptionMutationErrorHandlers,
} from '../../../../client/stories/msw/settings-handlers-personal-2.js'

function pathsOf(handlers: readonly HttpHandler[]): string[] {
  return handlers.map((h) => String(h.info.path))
}

describe('personal settings msw handlers (part 2)', () => {
  // --- configHandlers ---

  test('configHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(configHandlers.populated)).toBe(true)
    expect(Array.isArray(configHandlers.empty)).toBe(true)
    expect(Array.isArray(configHandlers.error)).toBe(true)
    expect(Array.isArray(configHandlers.loading)).toBe(true)
    expect(configHandlers.populated.length).toBeGreaterThan(0)
  })

  test('configHandlers populated covers /settings/api/config', () => {
    expect(pathsOf(configHandlers.populated).some((p) => p.includes('/settings/api/config'))).toBe(true)
  })

  // --- releaseSubscriptionHandlers ---

  test('releaseSubscriptionHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(releaseSubscriptionHandlers.populated)).toBe(true)
    expect(Array.isArray(releaseSubscriptionHandlers.empty)).toBe(true)
    expect(Array.isArray(releaseSubscriptionHandlers.error)).toBe(true)
    expect(Array.isArray(releaseSubscriptionHandlers.loading)).toBe(true)
    expect(releaseSubscriptionHandlers.populated.length).toBeGreaterThan(0)
  })

  test('releaseSubscriptionHandlers populated covers /settings/api/release-subscription', () => {
    expect(
      pathsOf(releaseSubscriptionHandlers.populated).some((p) => p.includes('/settings/api/release-subscription')),
    ).toBe(true)
  })

  // --- releaseSubscriptionMutatingHandlers / releaseSubscriptionMutationErrorHandlers ---

  test('releaseSubscriptionMutatingHandlers covers GET and PATCH for /settings/api/release-subscription', () => {
    const paths = pathsOf(releaseSubscriptionMutatingHandlers)
    expect(paths.filter((p) => p.includes('/settings/api/release-subscription')).length).toBe(2)
  })

  test('releaseSubscriptionMutationErrorHandlers covers GET and PATCH for /settings/api/release-subscription', () => {
    const paths = pathsOf(releaseSubscriptionMutationErrorHandlers)
    expect(paths.filter((p) => p.includes('/settings/api/release-subscription')).length).toBe(2)
  })

  // --- analyticsPreferencesHandlers ---

  test('analyticsPreferencesHandlers has all four variants with at least one handler each', () => {
    expect(Array.isArray(analyticsPreferencesHandlers.populated)).toBe(true)
    expect(Array.isArray(analyticsPreferencesHandlers.empty)).toBe(true)
    expect(Array.isArray(analyticsPreferencesHandlers.error)).toBe(true)
    expect(Array.isArray(analyticsPreferencesHandlers.loading)).toBe(true)
    expect(analyticsPreferencesHandlers.populated.length).toBeGreaterThan(0)
  })

  test('analyticsPreferencesHandlers populated covers /settings/api/analytics/preferences', () => {
    expect(
      pathsOf(analyticsPreferencesHandlers.populated).some((p) => p.includes('/settings/api/analytics/preferences')),
    ).toBe(true)
  })

  test('analyticsWithdrawalInProgressHandlers covers preferences GET and delete POST', () => {
    const paths = pathsOf(analyticsWithdrawalInProgressHandlers)
    expect(paths.some((p) => p.includes('/settings/api/analytics/preferences'))).toBe(true)
    expect(paths.some((p) => p.includes('/settings/api/analytics/delete'))).toBe(true)
  })
})
