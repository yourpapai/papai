// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getResponse } from 'msw'
import type { HttpHandler } from 'msw'

import {
  analyticsLegitimateInterestHandlers,
  analyticsPreferencesHandlers,
  analyticsRightsUnavailableHandlers,
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

  test('configHandlers populated response carries exactly the three profile fields', async () => {
    const response = await getResponse(
      configHandlers.populated,
      new Request('http://localhost/settings/api/config?contextId=ctx-personal-1'),
    )
    expect(response).toBeDefined()
    const body: unknown = await response?.json()
    // Full deep equality (not objectContaining) so a malformed language select — wrong
    // control, missing options, stray field keys — fails here rather than downstream
    // in the Profile section stories that render from this fixture.
    expect(body).toEqual({
      contextId: 'ctx-personal-1',
      fields: [
        {
          key: 'display_name',
          label: 'Display name',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'Alice',
          storageKey: 'display_name',
          kind: 'preference',
          control: 'text',
        },
        {
          key: 'language',
          label: 'Language',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'en',
          storageKey: 'language',
          kind: 'preference',
          control: 'select',
          options: [
            { value: 'en', label: 'English' },
            { value: 'ru', label: 'Русский' },
          ],
        },
        {
          key: 'ai_output_detail_level',
          label: 'Output detail level',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'standard',
          storageKey: 'ai_output_detail_level',
          kind: 'ai-output',
          control: 'select',
          options: [
            { value: 'standard', label: 'Standard' },
            { value: 'raw', label: 'Raw' },
          ],
        },
      ],
    })
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

  test('analyticsRightsUnavailableHandlers covers the preferences GET', () => {
    expect(
      pathsOf(analyticsRightsUnavailableHandlers).some((p) => p.includes('/settings/api/analytics/preferences')),
    ).toBe(true)
  })

  test('analyticsLegitimateInterestHandlers covers the preferences GET', () => {
    expect(
      pathsOf(analyticsLegitimateInterestHandlers).some((p) => p.includes('/settings/api/analytics/preferences')),
    ).toBe(true)
  })
})
