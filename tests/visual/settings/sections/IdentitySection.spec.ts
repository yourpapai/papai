// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/IdentitySection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Gated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--gated')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test.describe('settings/sections/IdentitySection — manual', () => {
  test('Populated — narrow 640', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--populated')
    await sharedPage.setViewportSize({ width: 640, height: 900 })
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated — long values', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--populated')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage
      .getByTestId('identity-user-id')
      .fill('user-account-9f3c2a1b-7e4d-4c6a-b2f1-000000000042-provider-scoped')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated — Clear hover', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--populated')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('identity-clear').hover()
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty — user-id focus-within', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--empty')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('identity-user-id').click()
    await expect(sharedPage).toHaveScreenshot()
  })
})
