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

test('AnalyticsPreferences — aggregate default, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — mixed preferences, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--mixed-preferences')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — destructive action hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
  await sharedPage.getByTestId('analytics-delete').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — keyboard focus lands on the first choice', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
  await sharedPage.getByTestId('analytics-notice').click()
  await sharedPage.keyboard.press('Tab')
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — withdraw confirmation', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
  await sharedPage.getByTestId('analytics-withdraw').click()
  await expect(sharedPage.getByTestId('confirm-accept')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — delete confirmation', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--withdrawal-in-progress')
  await sharedPage.getByTestId('analytics-delete').click()
  await expect(sharedPage.getByTestId('confirm-accept')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — after a queued deletion', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--withdrawal-in-progress')
  await sharedPage.getByTestId('analytics-delete').click()
  await sharedPage.getByTestId('confirm-accept').click()
  await expect(sharedPage.getByTestId('analytics-success')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — a failed preference save', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
  await sharedPage.getByTestId('analytics-local-deny').click()
  await expect(sharedPage.getByTestId('analytics-error')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — confirmation dialog, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--aggregate-default')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.getByTestId('analytics-withdraw').click()
  await expect(sharedPage.getByTestId('confirm-accept')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
