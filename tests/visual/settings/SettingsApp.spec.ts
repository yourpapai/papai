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

  test('Unauthenticated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--unauthenticated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Failed', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-settingsapp--failed')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

import { pinDefaultViewport } from '../support/viewport.js'

pinDefaultViewport()

// ---- depth-B review states (dims 6, 7, 8, 9) ----

// The sidebar is display:none below 900px and the jump <select> takes over, so
// narrow is the only viewport where the shell's whole navigation model is visible.
test('SettingsApp — personal, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 900px is the exact breakpoint edge: sidebar and jump menu both flip here.
test('SettingsApp — personal, breakpoint edge', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 900, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 940px is the first width above the breakpoint: the rail is back and the main
// column has room. This is the state that used to squeeze at 760px.
test('SettingsApp — just above breakpoint', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 940, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 760px used to sit above the old 720px cutover with a 220px rail and a ~492px
// content column. It is now single-column; this state pins that.
test('SettingsApp — former squeeze band', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 760, height: 900 })
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

// The Admin group is collapsed by default: this is what an admin now lands on,
// with sixteen sections behind one disclosure instead of mounted and fetching.
test('SettingsApp — admin zone collapsed', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await expect(sharedPage).toHaveScreenshot()
})

// The admin zone's danger framing at narrow width, where its wide max-width
// and the ADMIN cutout label have the least room. Expanded and scrolled into
// view — the zone sits far below the fold behind every personal section.
test('SettingsApp — admin zone, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.getByTestId('admin-toggle').click()
  await sharedPage.locator('#instances').scrollIntoViewIfNeeded()
  await expect(sharedPage).toHaveScreenshot()
})

// The admin sidebar expanded is the tallest nav the shell ever renders (16 links).
// At a short viewport its tail used to be clipped by a sticky max-height:100vh box
// taller than the scrollport; the rail now scrolls inside its own grid track.
test('SettingsApp — admin sidebar, short viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await sharedPage.setViewportSize({ width: 1280, height: 600 })
  await sharedPage.getByTestId('sidebar-toggle-Admin').click()
  await expect(sharedPage).toHaveScreenshot()
})
