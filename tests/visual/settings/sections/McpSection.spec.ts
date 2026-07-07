// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/McpSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-mcpsection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-mcpsection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-mcpsection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('McpSection — populated, narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 1100 })
  await expect(sharedPage).toHaveScreenshot()
})

test('McpSection — header row + new endpoint expanded', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
  await sharedPage.getByTestId('mcp-header-add-e1').click()
  await sharedPage.getByTestId('mcp-add').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('McpSection — long label and url overflow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
  const row = sharedPage.getByTestId('mcp-row-e1')
  await row.locator('input').first().fill('Production analytics MCP gateway (EU-west, read-only replica)')
  await row
    .locator('input')
    .nth(1)
    .fill('https://mcp.analytics.internal.example.com/servers/production/streamable-http/v2/endpoint?tenant=acme-corp')
  await expect(sharedPage).toHaveScreenshot()
})

test('McpSection — long label and url overflow, narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 1100 })
  const row = sharedPage.getByTestId('mcp-row-e1')
  await row.locator('input').first().fill('Production analytics MCP gateway (EU-west, read-only replica)')
  await row
    .locator('input')
    .nth(1)
    .fill('https://mcp.analytics.internal.example.com/servers/production/streamable-http/v2/endpoint?tenant=acme-corp')
  await expect(sharedPage).toHaveScreenshot()
})

test('McpSection — save hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
  await sharedPage.getByTestId('mcp-save').hover()
  await expect(sharedPage).toHaveScreenshot()
})
