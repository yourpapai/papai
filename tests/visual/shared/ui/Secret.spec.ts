// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Secret', () => {
  test('Masked with hint', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-secret--masked-with-hint')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
