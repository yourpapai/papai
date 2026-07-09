// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { magiDynamicHosts, magiHttpFetch } from '../../../../src/modules/coding/acp/http-fetch.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { setupTestDb } from '../../../utils/test-helpers.js'

describe('acp http-fetch dynamic hosts', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  it('is a callable fetch', () => {
    expect(typeof magiHttpFetch).toBe('function')
  })

  it('derives the magi hostname (port-agnostic) from admin config', () => {
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example.com:8080/', 'admin')
    expect([...magiDynamicHosts()]).toEqual(['magi.example.com'])
  })

  it('returns an empty set when unset or invalid', () => {
    // setupTestDb() gives a clean DB, so magi_base_url is unset here.
    expect([...magiDynamicHosts()]).toEqual([])
    setPluginAdminConfig('acp', 'magi_base_url', 'not a url', 'admin')
    expect([...magiDynamicHosts()]).toEqual([])
  })
})
