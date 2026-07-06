// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/MemorySection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty (capture on)', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--empty-capture-on')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Provisional', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--provisional')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test.describe('settings/sections/MemorySection — manual', () => {
  test('Populated — narrow 640', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--populated')
    await sharedPage.setViewportSize({ width: 640, height: 900 })
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated — clear confirm open', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--populated')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('memory-clear').click()
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated — clear button hover', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--populated')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('memory-clear').hover()
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated — profile textarea focused', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memorysection--populated')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('memory-profile').focus()
    await expect(sharedPage).toHaveScreenshot()
  })
})
