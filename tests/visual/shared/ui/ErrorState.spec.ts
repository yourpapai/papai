// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/ErrorState', () => {
  test('With retry', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-errorstate--with-retry')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Message only', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-errorstate--message-only')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
