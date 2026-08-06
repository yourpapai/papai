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

// ---- depth-B review states (dims 6, 7, 8, 9) ----

// Below 720px `admin.css` reflows the rail to `flex-flow: row wrap`. This is the
// only viewport where the whole navigation model is visible at once.
test('AdminApp — narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 720px is the exact breakpoint edge: the grid flips to one column here.
test('AdminApp — breakpoint edge', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 720, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 760px is the first width above the cutover: a fixed 220px rail against a
// ~540px content column is where the section cards squeeze hardest.
test('AdminApp — just above breakpoint', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 760, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// Hover on a sidebar link — the only affordance signalling the nav is interactive.
test('AdminApp — sidebar link hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.getByRole('link', { name: 'Identities' }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

// The rail is the tallest fixed element the shell renders. At a short viewport
// its position and its overflow behaviour are what decide whether the quick
// stats below the links are reachable at all.
test('AdminApp — short viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 1280, height: 600 })
  await expect(sharedPage).toHaveScreenshot()
})

// The sections below the fold: the generated shots stop inside Overview, so
// Billing through Identities are never captured by the default set.
test('AdminApp — identities section scrolled into view', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.locator('#identities').scrollIntoViewIfNeeded()
  await expect(sharedPage).toHaveScreenshot()
})
