// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/KV', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-kv--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('With sub', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-kv--with-sub')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Colored value', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-kv--colored-value')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Dim', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-kv--dim')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('With Pill value', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-kv--with-pill-value')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
