// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { buildSettingsUrlFromBase, getSettingsPublicBaseUrl } from '../../src/settings/config.js'

describe('settings config', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(() => {
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('getSettingsPublicBaseUrl returns null when unset', () => {
    expect(getSettingsPublicBaseUrl()).toBeNull()
  })

  test('getSettingsPublicBaseUrl strips trailing slashes', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com///'
    expect(getSettingsPublicBaseUrl()).toBe('https://bot.example.com')
  })

  test('buildSettingsUrlFromBase encodes the code onto the given base', () => {
    expect(buildSettingsUrlFromBase('https://bot.example.com', 'a b+c')).toBe(
      'https://bot.example.com/settings?code=a%20b%2Bc',
    )
  })
})
