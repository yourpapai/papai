// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/AnalyticsPreferencesSection', () => {
  test('AggregateDefault', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('MixedPreferences', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--mixed-preferences')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('WithdrawalInProgress', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--withdrawal-in-progress')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()
