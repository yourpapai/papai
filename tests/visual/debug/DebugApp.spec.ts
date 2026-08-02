// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('debug/DebugApp', () => {
  test('Connecting', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-debugapp--connecting')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-debugapp--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Detail selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-debugapp--detail-selected')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Disconnected empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-debugapp--disconnected-empty')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../support/viewport.js'

pinDefaultViewport()
test('DebugApp — narrow 640px', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'debug-debugapp--default')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('DebugApp — detail selected, narrow 640px', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'debug-debugapp--detail-selected')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
