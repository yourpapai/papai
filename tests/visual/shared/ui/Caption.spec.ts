// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Caption', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-caption--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Long edge', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-caption--long-edge')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
