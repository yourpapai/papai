// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { loadTrustedModules } from '../../../../src/composition/load-trusted-modules.js'
import {
  configureMagiHttpFetch,
  magiDynamicHosts,
  magiHttpFetch,
} from '../../../../src/modules/coding/acp/http-fetch.js'
import { codingModule } from '../../../../src/modules/coding/module.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { restoreFetch, setMockFetch, setupTestDb } from '../../../utils/test-helpers.js'

describe('acp http-fetch dynamic hosts', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterEach(() => {
    configureMagiHttpFetch()
    restoreFetch()
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

  it('uses the composition-provided hardened fetch dependencies', async () => {
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example.com', 'admin')
    const requests: string[] = []
    configureMagiHttpFetch({
      fetch: (url: string): Promise<Response> => {
        requests.push(url)
        return Promise.resolve(new Response('ok'))
      },
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    })

    await magiHttpFetch('https://magi.example.com/agents')

    expect(requests).toEqual(['https://magi.example.com/agents'])
  })

  it('restores the safe default fetch when the coding module is unloaded', async () => {
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example.com', 'admin')
    const injectedRequests: string[] = []
    await loadTrustedModules([codingModule], () => {}, {
      http: {
        fetch: (url: string): Promise<Response> => {
          injectedRequests.push(url)
          return Promise.resolve(new Response('injected'))
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })
    await magiHttpFetch('https://magi.example.com/agents')
    const defaultRequests: string[] = []
    setMockFetch((url: string): Promise<Response> => {
      defaultRequests.push(url)
      return Promise.resolve(new Response('default'))
    })

    await loadTrustedModules([], () => {})
    await magiHttpFetch('https://magi.example.com/agents')

    expect(injectedRequests).toEqual(['https://magi.example.com/agents'])
    expect(defaultRequests).toEqual(['https://magi.example.com/agents'])
  })
})
