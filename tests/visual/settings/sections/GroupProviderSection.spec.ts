// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/GroupProviderSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-groupprovidersection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-groupprovidersection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-groupprovidersection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-groupprovidersection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('GroupProviderSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-groupprovidersection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('GroupProviderSection — select focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-groupprovidersection--populated')
  await sharedPage.getByTestId('group-task-instance').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('GroupProviderSection — save hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-groupprovidersection--populated')
  await sharedPage.getByTestId('group-task-instance-save').hover()
  await expect(sharedPage).toHaveScreenshot()
})
