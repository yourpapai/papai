// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('transcript/TranscriptView', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty connecting', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--empty-connecting')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty live', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--empty-live')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty finished', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--empty-finished')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty invalid token', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--empty-invalid-token')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty recording disabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--empty-recording-disabled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptview--empty-error')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../support/viewport.js'

pinDefaultViewport()

test('TranscriptView — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'transcript-transcriptview--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
