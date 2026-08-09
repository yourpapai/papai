// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/admin/AdminUsersSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../../support/viewport.js'

pinDefaultViewport()

test('AdminUsersSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
  await sharedPage.setViewportSize({ width: 1280, height: 720 })
})

test('AdminUsersSection — remove hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
  await sharedPage.getByTestId('user-remove-123456789').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminUsersSection — remove confirm open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
  await sharedPage.getByTestId('user-remove-123456789').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminUsersSection — keyboard focus on first control', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
  await sharedPage.keyboard.press('Tab')
  await sharedPage.keyboard.press('Tab')
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminUsersSection — search with no matches', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
  await sharedPage.getByTestId('settings-table-search').fill('zzzz')
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminUsersSection — add submitted with blank id', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--populated')
  // The Add button is now disabled while the User ID field is blank (Task 8), so it
  // can no longer be clicked to trigger validation — touch the field instead by typing
  // and clearing it, which reveals the same inline error the button-guard prevents.
  const input = sharedPage.getByTestId('user-add-input')
  await input.fill('x')
  await input.fill('')
  await expect(sharedPage).toHaveScreenshot()
})

test('AdminUsersSection — open-access read failed', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--open-access-error')
  await expect(sharedPage).toHaveScreenshot()
})
