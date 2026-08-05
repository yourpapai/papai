// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/PluginsSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-pluginssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-pluginssection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-pluginssection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-pluginssection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Configurable', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-pluginssection--configurable')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Ineligible', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-pluginssection--ineligible')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()

test('Plugins — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-pluginssection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Plugins — toggle hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-pluginssection--populated')
  await sharedPage.getByTestId('plugin-toggle-task-provider-kaneo').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Plugins — refresh hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-pluginssection--populated')
  await sharedPage.getByTestId('plugins-refresh').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Plugins — empty, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-pluginssection--empty')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Plugins — error, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-pluginssection--error')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
