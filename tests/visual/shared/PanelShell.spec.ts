// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/PanelShell', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-panelshell--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-panelshell--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-panelshell--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Long title edge', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-panelshell--long-title-edge')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
