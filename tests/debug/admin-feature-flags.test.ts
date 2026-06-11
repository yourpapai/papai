// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { setConfigValue } from '../../src/config.js'
import {
  AdminFeatureFlagsError,
  applyAdminFeatureFlagsUpdate,
  getAdminFeatureFlagsSnapshot,
} from '../../src/debug/admin-feature-flags.js'
import { upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { addPendingUser, addUser } from '../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const ALL_OFF = { result_compaction: false, progressive_disclosure: false, semantic_tool_retrieval: false }
const userCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
const groupCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-1' })

describe('admin-feature-flags', () => {
  const savedKill = process.env['TOOL_CONTEXT_REDUCTION_DISABLED']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: 'alice' })
    upsertKnownGroupContext({
      contextId: groupCtx,
      provider: 'mattermost',
      displayName: 'Dev Team',
      parentName: 'Acme',
    })
  })

  afterEach(() => {
    if (savedKill === undefined) delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    else process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = savedKill
  })

  it('lists user and group contexts with parsed flags, users first, sorted by label', () => {
    setConfigValue(userCtx, 'tool_context_flags', '{"result_compaction":true}')
    const snapshot = getAdminFeatureFlagsSnapshot()
    expect(snapshot.killSwitchEngaged).toBe(false)
    const userRow = snapshot.contexts.find((r) => r.contextId === userCtx)
    const groupRow = snapshot.contexts.find((r) => r.contextId === groupCtx)
    expect(userRow).toEqual({
      contextId: userCtx,
      kind: 'user',
      label: 'alice',
      platformInstanceLabel: 'pi-1',
      flags: { ...ALL_OFF, result_compaction: true },
    })
    expect(groupRow).toEqual({
      contextId: groupCtx,
      kind: 'group',
      label: 'Dev Team — Acme',
      platformInstanceLabel: 'pi-1',
      flags: ALL_OFF,
    })
    expect(snapshot.contexts.indexOf(userRow!)).toBeLessThan(snapshot.contexts.indexOf(groupRow!))
  })

  it('reports the kill switch', () => {
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    expect(getAdminFeatureFlagsSnapshot().killSwitchEngaged).toBe(true)
  })

  it('applies an update for a known context and returns the updated row', () => {
    const updated = applyAdminFeatureFlagsUpdate(userCtx, { ...ALL_OFF, progressive_disclosure: true })
    expect(updated.flags.progressive_disclosure).toBe(true)
    const snapshot = getAdminFeatureFlagsSnapshot()
    expect(snapshot.contexts.find((r) => r.contextId === userCtx)?.flags.progressive_disclosure).toBe(true)
  })

  it('rejects an unknown context', () => {
    expect(() => applyAdminFeatureFlagsUpdate('pi:bogus:ctx:bogus', ALL_OFF)).toThrow(AdminFeatureFlagsError)
  })

  it('excludes placeholder (pending) users', () => {
    addPendingUser({ username: 'ghost', platformInstanceId: 'pi-1', addedBy: 'boot' })
    const snapshot = getAdminFeatureFlagsSnapshot()
    expect(snapshot.contexts.map((r) => r.contextId).toSorted()).toEqual([groupCtx, userCtx].toSorted())
  })

  it('sorts same-kind rows by label', () => {
    addUser({ userId: 'u-2', platformInstanceId: 'pi-1', addedBy: 'boot', username: 'bob' })
    const labels = getAdminFeatureFlagsSnapshot()
      .contexts.filter((r) => r.kind === 'user')
      .map((r) => r.label)
    expect(labels).toEqual(['alice', 'bob'])
  })

  it('labels a group without parentName by displayName alone', () => {
    const soloCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-2' })
    upsertKnownGroupContext({ contextId: soloCtx, provider: 'mattermost', displayName: 'Solo', parentName: null })
    const row = getAdminFeatureFlagsSnapshot().contexts.find((r) => r.contextId === soloCtx)
    expect(row?.label).toBe('Solo')
  })
})
