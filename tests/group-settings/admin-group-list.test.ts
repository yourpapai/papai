// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { listKnownGroupContextsForPlatform } from '../../src/group-settings/admin-group-list.js'
import { upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const scoped = (platformInstanceId: string, nativeContextId: string): string =>
  toScopedContextId({ platformInstanceId, nativeContextId })

describe('listKnownGroupContextsForPlatform', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns only same-instance groups, sorted by display name', () => {
    upsertKnownGroupContext({
      contextId: scoped('pi-1', 'b'),
      provider: 'mattermost',
      displayName: 'Beta',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: scoped('pi-1', 'a'),
      provider: 'mattermost',
      displayName: 'Alpha',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: scoped('pi-2', 'c'),
      provider: 'mattermost',
      displayName: 'Gamma',
      parentName: null,
    })

    const result = listKnownGroupContextsForPlatform('pi-1')

    expect(result.map((g) => g.displayName)).toEqual(['Alpha', 'Beta'])
    expect(result.map((g) => g.contextId)).toEqual([scoped('pi-1', 'a'), scoped('pi-1', 'b')])
  })
})
