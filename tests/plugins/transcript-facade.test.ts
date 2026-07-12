// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { buildTranscriptFacade } from '../../src/plugins/transcript-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  await setupTestDb()
})
afterEach(() => {
  delete process.env['INSTANCE_CONFIG_KEY']
  delete process.env['SETTINGS_PUBLIC_BASE_URL']
})

test('mintUrl returns null when no public base URL is configured', () => {
  delete process.env['SETTINGS_PUBLIC_BASE_URL']
  const facade = buildTranscriptFacade('acp', true)
  expect(facade.mintUrl('sess-1')).toBeNull()
})

test('mintUrl returns an absolute /t/<token> URL when a public base URL is configured', () => {
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
  const facade = buildTranscriptFacade('acp', true)
  const url = facade.mintUrl('sess-1')
  expect(url).not.toBeNull()
  expect(url).toMatch(/^https:\/\/papai\.example\/t\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u)
})

test('mintUrl throws without the coding.secrets permission', () => {
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
  const facade = buildTranscriptFacade('acp', false)
  expect(() => facade.mintUrl('sess-1')).toThrow("does not have 'coding.secrets' permission")
})
