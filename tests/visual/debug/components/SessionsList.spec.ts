// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('debug/components/SessionsList', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessionslist--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessionslist--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-sessionslist--selected')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()
test('SessionCard — keyboard focus ring', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'debug-components-sessioncard--default')
  await sharedPage.keyboard.press('Tab')
  await expect(sharedPage).toHaveScreenshot()
})
