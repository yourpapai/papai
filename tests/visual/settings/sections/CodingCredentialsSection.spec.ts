// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/CodingCredentialsSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingcredentialssection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingcredentialssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingcredentialssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('Populated — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Empty — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--empty')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — base URL input focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-input-provider_base_url').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — API key replace open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-replace-provider_api_key').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — dirty, Save enabled + hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-input-provider_base_url').fill('https://llm.example.com/v1')
  await sharedPage.getByTestId('coding-credentials-save').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — clear confirm dialog', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-credentials-clear').click()
  await expect(sharedPage).toHaveScreenshot()
})
