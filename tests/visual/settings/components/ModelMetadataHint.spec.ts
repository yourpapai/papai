// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/components/ModelMetadataHint', () => {
  test('Models dev hit', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-modelmetadatahint--models-dev-hit')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Prefix guess', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-modelmetadatahint--prefix-guess')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('No limits known', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-modelmetadatahint--no-limits-known')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Catalogue unavailable', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-components-modelmetadatahint--catalogue-unavailable')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

// The hint resolves through a debounced fetch, so the generated captures above can
// win the race against the 300 ms debounce and shoot the pre-fetch blank state.
// These manual captures await networkidle first, making each state deterministic.
test('ModelMetadataHint — models.dev hit, settled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-components-modelmetadatahint--models-dev-hit')
  await sharedPage.waitForLoadState('networkidle')
  await expect(sharedPage).toHaveScreenshot()
})

test('ModelMetadataHint — prefix guess, settled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-components-modelmetadatahint--prefix-guess')
  await sharedPage.waitForLoadState('networkidle')
  await expect(sharedPage).toHaveScreenshot()
})

test('ModelMetadataHint — no limits known, settled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-components-modelmetadatahint--no-limits-known')
  await sharedPage.waitForLoadState('networkidle')
  await expect(sharedPage).toHaveScreenshot()
})

test('ModelMetadataHint — catalogue unavailable, settled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-components-modelmetadatahint--catalogue-unavailable')
  await sharedPage.waitForLoadState('networkidle')
  await expect(sharedPage).toHaveScreenshot()
})
