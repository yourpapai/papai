// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { upsertRepo } from '../../src/coding-repos/store.js'
import { buildCodingReposFacade } from '../../src/plugins/coding-secrets-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Use a plain context id (matching the coding-secrets-facade test pattern).
// configContextOf strips thread suffixes for properly-scoped pi: context ids;
// plain ids like this are returned as-is, so the store lookup uses the same id.
const STORAGE_CTX = 'pi:telegram:ctx:user-3'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
})
afterEach(() => {})

test('list returns repos stored at the config-context id', () => {
  upsertRepo(
    STORAGE_CTX,
    { name: 'demo', repoUrl: 'https://github.com/acme/demo.git', baseBranch: 'main', permissionPreset: 'cautious' },
    'user-3',
  )
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, true)
  expect(facade.list()).toEqual([{ name: 'demo', baseBranch: 'main' }])
})

test('list returns empty array when no repos configured', () => {
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, true)
  expect(facade.list()).toEqual([])
})

test('get returns the full repo record when found', () => {
  upsertRepo(
    STORAGE_CTX,
    { name: 'demo', repoUrl: 'https://github.com/acme/demo.git', baseBranch: 'main', permissionPreset: 'cautious' },
    'user-3',
  )
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, true)
  expect(facade.get('demo')).toEqual({
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: [],
  })
})

test('get returns null when repo not found', () => {
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, true)
  expect(facade.get('nonexistent')).toBeNull()
})

test('list throws without the coding.secrets permission', () => {
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, false)
  expect(() => facade.list()).toThrow("does not have 'coding.secrets' permission")
})

test('get() surfaces additionalEgressDomains', () => {
  upsertRepo(
    STORAGE_CTX,
    {
      name: 'egress-demo',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: ['pypi.org'],
    },
    'user-3',
  )
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, true)
  expect(facade.get('egress-demo')?.additionalEgressDomains).toEqual(['pypi.org'])
})

test('get throws without the coding.secrets permission', () => {
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, false)
  expect(() => facade.get('demo')).toThrow("does not have 'coding.secrets' permission")
})

test('list and get resolve repos stored at the config-context when called with a thread-scoped storage context id', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'pi-test',
    nativeContextId: 'group-7',
    threadId: 'thread-3',
  })
  const configContextId = getConfigContextIdFromStorageContextId(threadContextId)
  upsertRepo(
    configContextId,
    {
      name: 'thread-repo',
      repoUrl: 'https://github.com/acme/thread-repo.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
    'user-3',
  )
  const facade = buildCodingReposFacade('acp', threadContextId, true)
  expect(facade.list()).toEqual([{ name: 'thread-repo', baseBranch: 'main' }])
  expect(facade.get('thread-repo')).toEqual({
    name: 'thread-repo',
    repoUrl: 'https://github.com/acme/thread-repo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: [],
  })
})
