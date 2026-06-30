// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Meter', () => {
  test('Half', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-meter--half')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Full', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-meter--full')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Over capacity', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-meter--over-capacity')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
