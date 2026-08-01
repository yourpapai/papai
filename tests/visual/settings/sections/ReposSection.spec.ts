// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()

// @generated-begin auto-screenshots
test.describe('settings/sections/ReposSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-repossection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-repossection--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-repossection--error')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Loading', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-repossection--loading')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots

test('ReposSection — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 1100 })
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — empty, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--empty')
  await sharedPage.setViewportSize({ width: 640, height: 1100 })
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — add submit disabled, hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--empty')
  await sharedPage.getByTestId('repos-add-submit').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — name input focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--empty')
  await sharedPage.getByTestId('repos-add-name').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — preset select focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--empty')
  await sharedPage.getByTestId('repos-add-preset').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — egress textarea focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--empty')
  await sharedPage.getByTestId('repos-add-egress').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — form filled, primary enabled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--populated')
  await sharedPage.getByTestId('repos-add-name').fill('new-service')
  await sharedPage.getByTestId('repos-add-url').fill('https://github.com/org/new-service.git')
  await sharedPage.getByTestId('repos-add-branch').fill('main')
  await sharedPage.getByTestId('repos-add-submit').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — added, success status', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--populated')
  await sharedPage.getByTestId('repos-add-name').fill('new-service')
  await sharedPage.getByTestId('repos-add-url').fill('https://github.com/org/new-service.git')
  await sharedPage.getByTestId('repos-add-branch').fill('main')
  await sharedPage.getByTestId('repos-add-submit').click()
  await expect(sharedPage.getByText('Repository added.')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — delete hover on a row', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--populated')
  await sharedPage.getByTestId('repos-delete-repo_abc123').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('ReposSection — long content in the add form, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 1100 })
  await sharedPage.getByTestId('repos-add-name').fill('extremely-long-monorepo-package-name-for-overflow-checking')
  await sharedPage
    .getByTestId('repos-add-url')
    .fill('https://gitlab.self-hosted.internal.example.company.com/platform/group/subgroup/very-long-repo-name.git')
  await sharedPage.getByTestId('repos-add-branch').fill('release/2026-08-long-lived-integration-branch')
  await sharedPage
    .getByTestId('repos-add-egress')
    .fill('pypi.org, files.pythonhosted.org, registry.npmjs.org, objects.githubusercontent.com, proxy.golang.org')
  await expect(sharedPage).toHaveScreenshot()
})
