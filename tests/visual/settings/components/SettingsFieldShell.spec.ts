// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/components/SettingsFieldShell', () => {
  test('Editor open, required', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-settingsfieldshell--editor-open-required')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Masked resting', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-settingsfieldshell--masked-resting')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Optional with footer hint', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-settingsfieldshell--optional-with-footer-hint')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
