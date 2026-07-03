// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/ReleaseSubscriptionSection', () => {
  test('Subscribed', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--subscribed')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Unsubscribed', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--unsubscribed')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('Unsubscribed — primary button hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--unsubscribed')
  await sharedPage.getByTestId('release-subscription-toggle').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Unsubscribed — primary button focus', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--unsubscribed')
  await sharedPage.getByTestId('release-subscription-toggle').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('Subscribed — outline button hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--subscribed')
  await sharedPage.getByTestId('release-subscription-toggle').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Subscribed — narrow viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--subscribed')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Error — narrow viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--error')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
