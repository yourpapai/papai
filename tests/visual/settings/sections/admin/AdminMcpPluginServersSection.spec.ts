// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/admin/AdminMcpPluginServersSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminmcppluginserverssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminmcppluginserverssection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminmcppluginserverssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminmcppluginserverssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test.describe('settings/sections/admin/AdminMcpPluginServersSection behavior', () => {
  test('renders a row for the available plugin with secure-by-default values', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminmcppluginserverssection--populated')

    const row = sharedPage.getByTestId('admin-mcp-plugin-servers-row-synthetic-web-search')
    await expect(row).toBeVisible()
    await expect(row).toContainText('Synthetic Web Search')
    await expect(row).toContainText('search')

    const enabledCheckbox = sharedPage.getByTestId('admin-mcp-plugin-servers-enabled-synthetic-web-search')
    await expect(enabledCheckbox).not.toBeChecked()

    const policySelect = sharedPage.getByTestId('admin-mcp-plugin-servers-policy-synthetic-web-search')
    await expect(policySelect).toHaveValue('deny')
  })

  test('shows the empty-state message when no plugins expose an MCP server', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminmcppluginserverssection--empty')
    await expect(sharedPage.getByText('No plugins expose an MCP server.')).toBeVisible()
  })
})
