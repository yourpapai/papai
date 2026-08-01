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

  test('Save validation error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codehostsection--save-validation-error')
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
  await sharedPage.getByTestId('coding-replace-forge_token').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — dirty form, primary enabled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-replace-forge_token').click()
  await sharedPage.getByTestId('coding-input-forge_token').fill('ghp_new_token_value')
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
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await sharedPage
    .getByTestId('coding-input-instance_url')
    .fill('https://gitlab.self-hosted.internal.example.company.com/api/v4/very/long/path/segment')
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — self-hosted kind reveals Instance URL', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — inline error under the offending field', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--save-validation-error')
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await sharedPage.getByTestId('code-host-save').click()
  await expect(sharedPage.getByText('required for self-hosted code hosts')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
