// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/TaskProviderSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-taskprovidersection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-taskprovidersection--error')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('TaskProvider — narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-taskprovidersection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
