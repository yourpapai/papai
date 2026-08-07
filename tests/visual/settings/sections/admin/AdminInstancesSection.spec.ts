// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/admin/AdminInstancesSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-admininstancessection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-admininstancessection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-admininstancessection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-admininstancessection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../../support/viewport.js'

pinDefaultViewport()

const POPULATED = 'settings-sections-admin-admininstancessection--populated'

test('AdminInstancesSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, POPULATED)
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminInstancesSection — delete hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, POPULATED)
  await sharedPage.getByTestId('platform-delete-tg-main').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminInstancesSection — delete confirm open', async ({ sharedPage }) => {
  await switchStory(sharedPage, POPULATED)
  await sharedPage.getByTestId('platform-delete-tg-main').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminInstancesSection — stop confirm open', async ({ sharedPage }) => {
  await switchStory(sharedPage, POPULATED)
  await sharedPage.getByTestId('platform-status-tg-main').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminInstancesSection — keyboard focus on first control', async ({ sharedPage }) => {
  await switchStory(sharedPage, POPULATED)
  await sharedPage.keyboard.press('Tab')
  await expect(sharedPage).toHaveScreenshot()
})
