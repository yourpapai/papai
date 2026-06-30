// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/TopBar', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-topbar--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('With secondary row', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-topbar--with-secondary-row')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Without status row', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-topbar--without-status-row')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
