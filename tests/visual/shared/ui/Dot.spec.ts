// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Dot', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-dot--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Danger', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-dot--danger')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Large no glow', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-dot--large-no-glow')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
