// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Input', () => {
  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-input--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Filled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-input--filled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Search type', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-input--search-type')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Readonly', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-input--readonly')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
