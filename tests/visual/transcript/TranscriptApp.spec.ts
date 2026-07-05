// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('transcript/TranscriptApp', () => {
  test('Connecting', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptapp--connecting')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Live', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptapp--live')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Finished', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptapp--finished')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Recording disabled', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptapp--recording-disabled')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Invalid token', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-transcriptapp--invalid-token')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
