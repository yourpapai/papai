// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ISSUE_LIMIT, type IssueSettingsLinkResult, issueSettingsLink } from '../../src/settings/issue-link.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

function getOkUrl(result: IssueSettingsLinkResult): string {
  if (result.kind !== 'ok') throw new Error(`Expected kind 'ok', got '${result.kind}'`)
  return result.url
}

describe('issueSettingsLink', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('returns not_configured when base url is unset', () => {
    expect(issueSettingsLink(principal, 0)).toEqual({ kind: 'not_configured' })
  })

  test('returns a single-use link when configured', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const result = issueSettingsLink(principal, 0)
    expect(result.kind).toBe('ok')
    expect(getOkUrl(result)).toMatch(/^https:\/\/bot\.example\.com\/settings\?code=[A-Za-z0-9_%-]+$/u)
  })

  test('rate-limits after the issue limit', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    for (let i = 0; i < ISSUE_LIMIT; i += 1) issueSettingsLink(principal, 0)
    const result = issueSettingsLink(principal, 0)
    expect(result.kind).toBe('rate_limited')
  })
})
