// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('admin/components/SubjectsTable', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-subjectstable--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-subjectstable--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Single row', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-subjectstable--single-row')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Many rows edge', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-subjectstable--many-rows-edge')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
