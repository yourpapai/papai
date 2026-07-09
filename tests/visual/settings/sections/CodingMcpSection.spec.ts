// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/CodingMcpSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('No catalog', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--no-catalog')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Internal available', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-available')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Internal selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-selected')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('CodingMcp — internal server option listed in picker', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-available')
  const options = await sharedPage.getByTestId('coding-mcp-select-server').locator('option').allTextContents()
  expect(options).toContain('plugin:synthetic-web-search')
})

test('CodingMcp — selecting an internal server hides the credential row', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-available')
  await expect(sharedPage.getByTestId('coding-mcp-row-upstream_token')).toBeVisible()
  await sharedPage.getByTestId('coding-mcp-select-server').selectOption('plugin:synthetic-web-search')
  await expect(sharedPage.getByTestId('coding-mcp-row-upstream_token')).toHaveCount(0)
})

test('CodingMcp — internal server pre-selected has no credential row', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-selected')
  await expect(sharedPage.getByTestId('coding-mcp-row-upstream_token')).toHaveCount(0)
})
