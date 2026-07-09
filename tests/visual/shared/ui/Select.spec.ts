// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Select', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-select--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Single option', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-select--single-option')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Placeholder', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-select--placeholder')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
