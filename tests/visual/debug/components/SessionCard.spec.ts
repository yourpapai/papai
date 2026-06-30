// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('debug/components/SessionCard', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessioncard--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('With active wizard', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessioncard--with-active-wizard')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Minimal session', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessioncard--minimal-session')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
