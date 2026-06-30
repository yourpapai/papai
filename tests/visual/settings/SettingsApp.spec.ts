// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/SettingsApp', () => {
  test('Personal ready', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Group ready', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--group-ready')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Admin ready', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
