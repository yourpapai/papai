// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/ByokSection', () => {
  test('Enabled with provider', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--enabled-with-provider')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Enabled no providers', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--enabled-no-providers')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Disabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--disabled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()

test('Enabled no providers — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-byoksection--enabled-no-providers')
  await sharedPage.setViewportSize({ width: 640, height: 700 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Enabled with provider — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-byoksection--enabled-with-provider')
  await sharedPage.setViewportSize({ width: 640, height: 700 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Enabled no providers — add-provider form open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-byoksection--enabled-no-providers')
  await sharedPage.getByTestId('byok-add-provider').click()
  await expect(sharedPage).toHaveScreenshot()
})
