// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Tag', () => {
  test('Required', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-tag--required')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Optional', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-tag--optional')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Neutral', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-tag--neutral')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Info', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-tag--info')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
