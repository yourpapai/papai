// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/MembersSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memberssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memberssection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memberssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-memberssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('MembersSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-memberssection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('MembersSection — add input focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-memberssection--populated')
  await sharedPage.setViewportSize({ width: 1280, height: 720 })
  await sharedPage.getByTestId('member-add-input').fill('@alice')
  await sharedPage.getByTestId('member-add-input').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('MembersSection — add button hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-memberssection--populated')
  await sharedPage.setViewportSize({ width: 1280, height: 720 })
  await sharedPage.getByTestId('member-add').hover()
  await expect(sharedPage).toHaveScreenshot()
})
