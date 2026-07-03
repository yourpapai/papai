// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/GuestModeSection', () => {
  test('Enabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-guestmodesection--enabled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Disabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-guestmodesection--disabled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-guestmodesection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-guestmodesection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('Disabled — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-guestmodesection--disabled')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Disabled — toggle hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-guestmodesection--disabled')
  await sharedPage.getByTestId('guest-mode-toggle').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Enabled — toggle hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-guestmodesection--enabled')
  await sharedPage.getByTestId('guest-mode-toggle').hover()
  await expect(sharedPage).toHaveScreenshot()
})
