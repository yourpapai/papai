// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/MetricCard', () => {
  test('default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-metriccard--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('single', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-metriccard--single')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('no-sub', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-metriccard--no-sub')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
