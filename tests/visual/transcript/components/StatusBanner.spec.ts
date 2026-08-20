// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('transcript/StatusBanner', () => {
  test('Connecting', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-statusbanner--connecting')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Live', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-statusbanner--live')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Finished', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-statusbanner--finished')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Recording disabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-statusbanner--recording-disabled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Invalid token', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-statusbanner--invalid-token')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-statusbanner--error')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()
