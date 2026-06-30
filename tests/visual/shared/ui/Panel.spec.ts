// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Panel', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-panel--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('With action', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-panel--with-action')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Dense flat edge', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-panel--dense-flat-edge')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Padded body', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-panel--padded-body')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
