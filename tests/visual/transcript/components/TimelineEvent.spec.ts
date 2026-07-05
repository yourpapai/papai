// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('transcript/TimelineEvent', () => {
  test('Message', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-timelineevent--message')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Tool call', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-timelineevent--tool-call')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Permission (read-only)', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-timelineevent--permission-read-only')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Result', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'transcript-timelineevent--result')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
