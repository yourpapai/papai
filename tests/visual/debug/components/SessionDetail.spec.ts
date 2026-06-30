// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('debug/components/SessionDetail', () => {
  test('With facts and config', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessiondetail--with-facts-and-config')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Minimal', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessiondetail--minimal')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
