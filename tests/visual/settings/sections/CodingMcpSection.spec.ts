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

test('CodingMcp — populated shows one row per selection; internal row has no credential input, external row does', async ({
  sharedPage,
}) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--populated')
  await expect(sharedPage.getByTestId('coding-mcp-row-0')).toBeVisible()
  await expect(sharedPage.getByTestId('coding-mcp-row-1')).toBeVisible()
  // Row 0 is the internal plugin selection — papai mints its credential.
  await expect(sharedPage.getByTestId('coding-mcp-token-0')).toHaveCount(0)
  // Row 1 is the external selection with a stored token — a credential input is shown, with a
  // "keep existing" affordance surfaced while it stays blank.
  await expect(sharedPage.getByTestId('coding-mcp-token-1')).toBeVisible()
})

test('CodingMcp — Add server disables once the operator cap is reached', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--populated')
  // Populated seeds 2 rows against a cap of 3.
  await expect(sharedPage.getByTestId('coding-mcp-add')).toBeEnabled()
  await sharedPage.getByTestId('coding-mcp-add').click()
  await expect(sharedPage.getByTestId('coding-mcp-row-2')).toBeVisible()
  await expect(sharedPage.getByTestId('coding-mcp-add')).toBeDisabled()
})

test('CodingMcp — removing a row drops it from the list', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--populated')
  await expect(sharedPage.getByTestId('coding-mcp-row-1')).toBeVisible()
  await sharedPage.getByTestId('coding-mcp-remove-1').click()
  await expect(sharedPage.getByTestId('coding-mcp-row-1')).toHaveCount(0)
})

test('CodingMcp — internal server option is offered in a new row', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-available')
  await sharedPage.getByTestId('coding-mcp-add').click()
  const options = await sharedPage.getByTestId('coding-mcp-server-0').locator('option').allTextContents()
  expect(options).toContain('Synthetic Web Search')
})

test('CodingMcp — selecting an internal server hides the credential input', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-available')
  await sharedPage.getByTestId('coding-mcp-add').click()
  await sharedPage.getByTestId('coding-mcp-server-0').selectOption('plugin:synthetic-web-search')
  await expect(sharedPage.getByTestId('coding-mcp-token-0')).toHaveCount(0)
})

test('CodingMcp — internal server pre-selected has no credential input', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--internal-selected')
  await expect(sharedPage.getByTestId('coding-mcp-token-0')).toHaveCount(0)
})
