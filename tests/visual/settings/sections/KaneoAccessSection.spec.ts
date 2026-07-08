// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/KaneoAccessSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Not provisioned', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--not-provisioned')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('Populated — password revealed', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--populated')
  await sharedPage.getByRole('button', { name: 'Reveal password' }).click()
  await sharedPage.getByText('Password (shown once):').waitFor()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — reveal button hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--populated')
  await sharedPage.getByRole('button', { name: 'Reveal password' }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Not provisioned — narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-kaneoaccesssection--not-provisioned')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
