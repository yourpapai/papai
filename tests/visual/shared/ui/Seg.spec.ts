// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Seg', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-seg--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Middle selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-seg--middle-selected')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Two options', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-seg--two-options')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
