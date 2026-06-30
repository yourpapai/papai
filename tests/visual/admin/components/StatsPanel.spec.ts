// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('admin/components/StatsPanel', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-statspanel--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-statspanel--empty')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
