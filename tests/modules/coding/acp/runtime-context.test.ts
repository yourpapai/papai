// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../../../src/chat/scoped-context.js'
import { buildRuntimeContext } from '../../../../src/modules/coding/acp/runtime-context.js'
import { upsertRepo } from '../../../../src/modules/coding/repos/store.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { mockLogger, setupTestDb } from '../../../utils/test-helpers.js'

// A recognized scoped-thread context id (pi:<b64>:ctx:<b64>:thread:<b64>) so that
// getConfigContextIdFromStorageContextId actually strips the thread suffix, exercising
// the group-config remap. A hand-rolled literal like 'tg:group:42:thread:99' would NOT
// match SCOPED_CONTEXT_PATTERN and the remap would be a no-op, defeating the test's point.
const STORAGE_CTX = toScopedThreadContextId({
  platformInstanceId: 'tg',
  nativeContextId: 'group42',
  threadId: 'thread-99',
})
const SIBLING_STORAGE_CTX = toScopedThreadContextId({
  platformInstanceId: 'tg',
  nativeContextId: 'group42',
  threadId: 'thread-100',
})
const CHAT_USER = 'u-1'

describe('buildRuntimeContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('reads admin config from the acp namespace', () => {
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.test', 'admin')
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    expect(rt.adminConfig.get('magi_base_url')).toBe('https://magi.test')
  })

  test('scopes kv to the config context under the literal acp namespace', () => {
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    rt.kv.set('session:s1', 'v1')
    const sibling = buildRuntimeContext(SIBLING_STORAGE_CTX, CHAT_USER)
    expect(sibling.kv.get('session:s1')).toBe('v1')
    expect(rt.kv.list('session:').map((r) => r.key)).toEqual(['session:s1'])
  })

  test('exposes the group config-context repo catalogue via codingRepos', () => {
    const cfgCtx = getConfigContextIdFromStorageContextId(STORAGE_CTX)
    upsertRepo(
      cfgCtx,
      { name: 'demo', repoUrl: 'https://github.com/x/y', baseBranch: 'main', permissionPreset: 'cautious' },
      'admin',
    )
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    expect(rt.codingRepos.list().map((r) => r.name)).toEqual(['demo'])
    expect(rt.codingRepos.get('demo')?.repoUrl).toBe('https://github.com/x/y')
    expect(rt.codingRepos.get('missing')).toBeNull()
  })

  test('preserves storageContextId (raw thread scope) for magi contextId', () => {
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    expect(rt.storageContextId).toBe(STORAGE_CTX)
  })
})
