// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('admin/components/SubjectDetail', () => {
  test('DM subject', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-subjectdetail--dm-subject')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Group subject', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'admin-components-subjectdetail--group-subject')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
