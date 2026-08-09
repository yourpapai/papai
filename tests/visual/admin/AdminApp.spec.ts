// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('admin/AdminApp', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-adminapp--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty data', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-adminapp--empty-data')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../support/viewport.js'

pinDefaultViewport()

// ---- post-fix states (dims 6, 7, 8, 9) ----

// 900px is the exact cutover: the rail is still present at this width.
test('AdminApp — breakpoint edge', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 900, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 940px is the first width above the cutover: a fixed 220px rail against a ~700px
// content column, which is where the section cards squeeze hardest.
test('AdminApp — just above breakpoint', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 940, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// Below the cutover the rail is gone and the jump menu is the whole navigation model.
test('AdminApp — narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage.getByTestId('admin-jump-select')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

// Hover on a rail link — hover and active must now read as one visual language.
test('AdminApp — sidebar link hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.getByRole('link', { name: 'Identities' }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

// A short viewport is what exposed the sticky/100vh rail: the quick stats below the
// links must still be reachable by scrolling inside the rail itself.
test('AdminApp — short viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 1280, height: 600 })
  await expect(sharedPage).toHaveScreenshot()
})

// The rail used to ride off the top once the page passed one viewport. Scrolling the
// main column to the last section must leave the whole rail in place.
test('AdminApp — identities section scrolled into view', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.locator('#identities').scrollIntoViewIfNeeded()
  await expect(sharedPage.getByRole('link', { name: 'Overview' })).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
