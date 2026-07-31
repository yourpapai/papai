// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/CodeHostSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codehostsection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codehostsection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codehostsection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('CodeHostSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — empty, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--empty')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — save hover (disabled primary)', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('code-host-save').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — replace secret open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-replace-provider_api_key').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — dirty form, primary enabled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-replace-provider_api_key').click()
  await sharedPage.getByTestId('coding-input-provider_api_key').fill('ghp_new_token_value')
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — clear confirm dialog', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('code-host-clear').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — long value overflow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage
    .getByTestId('coding-input-provider_base_url')
    .fill('https://gitlab.self-hosted.internal.example.company.com/api/v4/very/long/path/segment')
  await expect(sharedPage).toHaveScreenshot()
})
