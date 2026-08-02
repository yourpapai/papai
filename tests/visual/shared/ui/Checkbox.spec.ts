// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Checkbox', () => {
  test('On', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-checkbox--on')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Off', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-checkbox--off')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Disabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-checkbox--disabled')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()

// The 16px input box is exempt from the WCAG 2.2 AA SC 2.5.8 floor
// (tests/client/shared/control-target-size.test.ts) on the grounds that it sits inside a
// clickable <label> that is the actual pointer target. Measure the label's rendered click
// area directly so that claim is verified, not just plausible from reading the CSS.
test('Checkbox — label click-target clears the WCAG 2.2 AA SC 2.5.8 floor', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'shared-ui-checkbox--on')
  const height = await sharedPage.locator('label.ui-checkbox').evaluate((el) => el.getBoundingClientRect().height)
  expect(height).toBeGreaterThanOrEqual(24)
})
