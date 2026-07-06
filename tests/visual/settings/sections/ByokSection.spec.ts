// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/ByokSection', () => {
  test('Secret set', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--secret-set')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Missing required', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-byoksection--missing-required')
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

test('Missing required — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-byoksection--missing-required')
  await sharedPage.setViewportSize({ width: 640, height: 700 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Secret set — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-byoksection--secret-set')
  await sharedPage.setViewportSize({ width: 640, height: 700 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Missing required — input focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-byoksection--missing-required')
  await sharedPage.getByTestId('byok-input-ANTHROPIC_API_KEY').focus()
  await expect(sharedPage).toHaveScreenshot()
})
