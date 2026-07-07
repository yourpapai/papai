// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/CodingIdentitySection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingidentitysection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingidentitysection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingidentitysection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingidentitysection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('CodingIdentity — designated policy reveals member select', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingidentitysection--populated')
  await sharedPage.getByTestId('coding-identity-policy').selectOption('designated')
  await expect(sharedPage).toHaveScreenshot()
})

test('CodingIdentity — designated, narrow viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingidentitysection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.getByTestId('coding-identity-policy').selectOption('designated')
  await expect(sharedPage).toHaveScreenshot()
})

test('CodingIdentity — save button hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingidentitysection--populated')
  await sharedPage.getByTestId('coding-identity-save').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodingIdentity — policy select focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingidentitysection--populated')
  await sharedPage.getByTestId('coding-identity-policy').focus()
  await expect(sharedPage).toHaveScreenshot()
})
