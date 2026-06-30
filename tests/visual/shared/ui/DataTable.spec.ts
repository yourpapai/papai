// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/DataTable', () => {
  test('default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-datatable--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-datatable--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('clickable-with-selection', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-datatable--clickable-with-selection')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
