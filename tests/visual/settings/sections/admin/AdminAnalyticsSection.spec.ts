// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/admin/AdminAnalyticsSection', () => {
  test('AggregateDefault', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--aggregate-default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('IncompleteGovernance', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--incomplete-governance')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('GovernedLocalPilot', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--governed-local-pilot')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('KillSwitch', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--kill-switch')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('FailedSink', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--failed-sink')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('ReconciledHealthy', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--reconciled-healthy')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-admin-adminanalyticssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
