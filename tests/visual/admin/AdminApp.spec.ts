// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('admin/AdminApp', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-adminapp--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty data', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-adminapp--empty-data')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
