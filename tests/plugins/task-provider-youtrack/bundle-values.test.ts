// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { makeBundleElementFetcher } from '../../../plugins/task-provider-youtrack/bundle-values.js'
import type { YouTrackConfig } from '../../../plugins/task-provider-youtrack/client.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const config: YouTrackConfig = { baseUrl: 'https://test.youtrack.cloud', token: 't' }

describe('makeBundleElementFetcher', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('fetches bundle element names and caches by bundle id', async () => {
    let calls = 0
    setMockFetch((url) => {
      calls++
      expect(url).toContain('/api/admin/customFieldSettings/bundles/state/sb-1/values')
      return Promise.resolve(
        new Response(JSON.stringify([{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const fetcher = makeBundleElementFetcher(config)
    const first = await fetcher('state', 'sb-1')
    const second = await fetcher('state', 'sb-1')

    expect(first.map((e) => e.name)).toEqual(['Open', 'In Progress'])
    const second_element = first[1]
    expect(second_element?.localizedName).toBe('В работе')
    // second call served from cache
    expect(calls).toBe(1)
    expect(second).toEqual(first)
  })
})
