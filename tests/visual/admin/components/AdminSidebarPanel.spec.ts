// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('admin/components/AdminSidebarPanel', () => {
  test('Overview active', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-adminsidebarpanel--overview-active')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Billing active', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-adminsidebarpanel--billing-active')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('System active', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-adminsidebarpanel--system-active')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
