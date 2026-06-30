// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/Modal', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-modal--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('With footer', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-modal--with-footer')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Large', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-modal--large')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
