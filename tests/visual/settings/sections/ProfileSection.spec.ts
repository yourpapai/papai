// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/ProfileSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-profilesection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-profilesection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-profilesection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-profilesection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('ProfileSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.waitForLoadState('networkidle')
  await expect(sharedPage).toHaveScreenshot()
})

test('ProfileSection — input focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.waitForLoadState('networkidle')
  await sharedPage.getByTestId('cfg-input-display_name').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('ProfileSection — clear confirm dialog', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.waitForLoadState('networkidle')
  await sharedPage.getByTestId('cfg-clear-display_name').click()
  await expect(sharedPage).toHaveScreenshot()
})

// dim 9 — interaction & micro-states: hover on the primary (Save) and ghost (Clear) actions
test('ProfileSection — save hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.waitForLoadState('networkidle')
  await sharedPage.getByTestId('cfg-save-display_name').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('ProfileSection — clear hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.waitForLoadState('networkidle')
  await sharedPage.getByTestId('cfg-clear-display_name').hover()
  await expect(sharedPage).toHaveScreenshot()
})

// dim 8 — spacing/alignment/overflow with long content the short "Alice" fixture hides
test('ProfileSection — long value, desktop', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.waitForLoadState('networkidle')
  await sharedPage
    .getByTestId('cfg-input-display_name')
    .fill('Alexandra Christiana Wolfeschlegelsteinhausenbergerdorff the Third of Northumberland')
  await expect(sharedPage).toHaveScreenshot()
})

test('ProfileSection — long value, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-profilesection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.waitForLoadState('networkidle')
  await sharedPage
    .getByTestId('cfg-input-display_name')
    .fill('Alexandra Christiana Wolfeschlegelsteinhausenbergerdorff the Third of Northumberland')
  await expect(sharedPage).toHaveScreenshot()
})
