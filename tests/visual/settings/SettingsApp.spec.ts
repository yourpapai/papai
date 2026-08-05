// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/SettingsApp', () => {
  test('Personal ready', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Group ready', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--group-ready')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Admin ready', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../support/viewport.js'

pinDefaultViewport()

// ---- depth-B review states (dims 6, 7, 8, 9) ----

// The sidebar is display:none below 720px and the jump <select> takes over, so
// narrow is the only viewport where the shell's whole navigation model is visible.
test('SettingsApp — personal, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 720px is the exact breakpoint edge: sidebar and jump menu both flip here.
test('SettingsApp — personal, breakpoint edge', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 720, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// Advanced is collapsed by default, so its ten sections and the expanded
// toggle state never appear in the generated set.
test('SettingsApp — advanced expanded', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.getByTestId('advanced-toggle').click()
  await expect(sharedPage).toHaveScreenshot()
})

// Hover on a sidebar link — the only affordance signalling the nav is interactive.
test('SettingsApp — sidebar link hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.getByRole('link', { name: 'Tools' }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

// The admin zone's danger framing at narrow width, where its wide max-width
// and the ADMIN cutout label have the least room. Scrolled into view — the zone
// sits far below the fold behind every personal section.
test('SettingsApp — admin zone, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.locator('#instances').scrollIntoViewIfNeeded()
  await expect(sharedPage).toHaveScreenshot()
})

// 760px is the first width above the breakpoint: the 220px sidebar is back but
// the main column has not yet regained room, the squeeze the 640/720 pair hides.
test('SettingsApp — just above breakpoint', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 760, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// The admin sidebar is the tallest nav the shell ever renders (16 links, no
// collapse); at a short viewport its sticky max-height:100vh box overshoots
// the shell's scrollport.
test('SettingsApp — admin sidebar, short viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await sharedPage.setViewportSize({ width: 1280, height: 600 })
  await expect(sharedPage).toHaveScreenshot()
})
