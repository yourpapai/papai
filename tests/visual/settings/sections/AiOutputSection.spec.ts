// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/AiOutputSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-aioutputsection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-aioutputsection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-aioutputsection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-aioutputsection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('Populated — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-aioutputsection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 700 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — hover Raw segment', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-aioutputsection--populated')
  await sharedPage.setViewportSize({ width: 1280, height: 400 })
  await sharedPage.getByText('Raw', { exact: true }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — hover Clear', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-aioutputsection--populated')
  await sharedPage.setViewportSize({ width: 1280, height: 400 })
  await sharedPage.getByText('Clear', { exact: true }).hover()
  await expect(sharedPage).toHaveScreenshot()
})
