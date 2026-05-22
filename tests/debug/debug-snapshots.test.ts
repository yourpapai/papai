// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { getSessionSnapshots } from '../../src/cache-snapshots.js'
import { userCachesForTesting } from '../../src/cache.js'
import { getPollerSnapshot } from '../../src/deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../../src/message-cache/cache.js'
import { getPendingWritesCount, getIsFlushScheduled } from '../../src/message-cache/persistence.js'
import { getSchedulerSnapshot } from '../../src/scheduler.js'
import { getWizardSnapshots, createWizardSession, deleteWizardSession } from '../../src/wizard/state.js'

describe('message-cache persistence accessors', () => {
  test('getPendingWritesCount returns a number', () => {
    const count = getPendingWritesCount()
    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('getIsFlushScheduled returns a boolean', () => {
    const scheduled = getIsFlushScheduled()
    expect(typeof scheduled).toBe('boolean')
  })
})

describe('getMessageCacheSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getMessageCacheSnapshot()
    expect(snap).toHaveProperty('size')
    expect(snap).toHaveProperty('ttlMs')
    expect(snap).toHaveProperty('pendingWrites')
    expect(snap).toHaveProperty('isFlushScheduled')
    expect(typeof snap.size).toBe('number')
    expect(typeof snap.ttlMs).toBe('number')
    expect(snap.ttlMs).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe('getSchedulerSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getSchedulerSnapshot()
    expect(snap).toHaveProperty('running')
    expect(snap).toHaveProperty('tickCount')
    expect(snap).toHaveProperty('tickIntervalMs')
    expect(snap).toHaveProperty('heartbeatInterval')
    expect(snap).toHaveProperty('activeTickInProgress')
    expect(snap).toHaveProperty('taskProvider')
    expect(typeof snap.running).toBe('boolean')
    expect(typeof snap.tickCount).toBe('number')
    expect(snap.tickIntervalMs).toBe(60_000)
    expect(snap.heartbeatInterval).toBe(60)
  })

  test('reports not running when scheduler is stopped', () => {
    const snap = getSchedulerSnapshot()
    expect(snap.running).toBe(false)
    expect(snap.activeTickInProgress).toBe(false)
  })
})

describe('getPollerSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getPollerSnapshot()
    expect(snap).toHaveProperty('scheduledRunning')
    expect(snap).toHaveProperty('alertsRunning')
    expect(snap).toHaveProperty('scheduledIntervalMs')
    expect(snap).toHaveProperty('alertIntervalMs')
    expect(snap).toHaveProperty('maxConcurrentLlmCalls')
    expect(snap).toHaveProperty('maxConcurrentUsers')
    expect(snap.scheduledIntervalMs).toBe(60_000)
    expect(snap.alertIntervalMs).toBe(300_000)
    expect(snap.maxConcurrentLlmCalls).toBe(5)
    expect(snap.maxConcurrentUsers).toBe(10)
  })

  test('reports not running when pollers are stopped', () => {
    const snap = getPollerSnapshot()
    expect(snap.scheduledRunning).toBe(false)
    expect(snap.alertsRunning).toBe(false)
  })
})

describe('getWizardSnapshots', () => {
  test('returns empty array when no sessions exist', () => {
    const snaps = getWizardSnapshots('nonexistent-user')
    expect(snaps).toEqual([])
  })

  test('returns only sessions for requested userId', () => {
    createWizardSession({
      userId: 'admin-1',
      storageContextId: 'admin-1',
      totalSteps: 5,
      taskProvider: 'kaneo',
    })
    createWizardSession({
      userId: 'other-user',
      storageContextId: 'other-user',
      totalSteps: 5,
      taskProvider: 'kaneo',
    })

    const snaps = getWizardSnapshots('admin-1')
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.userId).toBe('admin-1')
    expect(snaps[0]!).toHaveProperty('currentStep')
    expect(snaps[0]!).toHaveProperty('totalSteps')
    expect(snaps[0]!).toHaveProperty('taskProvider')
    expect(snaps[0]!).toHaveProperty('skippedSteps')
    expect(snaps[0]!).toHaveProperty('dataKeys')
    expect(snaps[0]!).not.toHaveProperty('data')

    deleteWizardSession('admin-1', 'admin-1')
    deleteWizardSession('other-user', 'other-user')
  })
})

describe('getSessionSnapshots', () => {
  afterEach(() => {
    userCachesForTesting.clear()
  })

  test('returns empty array when no sessions exist', () => {
    const snaps = getSessionSnapshots('nonexistent')
    expect(snaps).toEqual([])
  })

  test('returns only sessions for requested userId', () => {
    userCachesForTesting.set('admin-1', {
      history: [{ role: 'user', content: 'hello' }],
      summary: 'test summary',
      facts: [{ identifier: 'TASK-1', title: 'Fix bug', url: 'http://example.com', last_seen: '2026-03-28' }],
      instructions: [{ id: 'i1', text: 'be concise', createdAt: '2026-03-28' }],
      config: new Map([
        ['llm_apikey', 'sk-test'],
        ['main_model', 'gpt-4o'],
      ]),
      workspaceId: 'ws-1',
      tools: {},
      lastAccessed: Date.now(),
    })
    userCachesForTesting.set('other-user', {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    })

    const snaps = getSessionSnapshots('admin-1')
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.userId).toBe('admin-1')
    expect(snaps[0]!.historyLength).toBe(1)
    expect(snaps[0]!.summary).toBe('test summary')
    expect(snaps[0]!.factsCount).toBe(1)
    expect(snaps[0]!.facts).toHaveLength(1)
    expect(snaps[0]!.configKeys).toContain('llm_apikey')
    expect(snaps[0]!.configKeys).toContain('main_model')
    expect(snaps[0]!.workspaceId).toBe('ws-1')
    expect(snaps[0]!.hasTools).toBe(true)
    expect(snaps[0]!.instructionsCount).toBe(1)
  })

  test('exposes config values for debug dashboard', () => {
    userCachesForTesting.set('admin-1', {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map([['llm_apikey', 'sk-secret-key']]),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    })

    const snaps = getSessionSnapshots('admin-1')
    const snap = snaps[0]!
    expect(snap.configKeys).toContain('llm_apikey')
    expect(snap).toHaveProperty('config')
    expect(snap.config).toEqual({ llm_apikey: 'sk-secret-key' })
  })

  test('filters out internal _loaded flags from configKeys', () => {
    userCachesForTesting.set('admin-1', {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map([
        ['main_model', 'gpt-4o'],
        ['history_loaded', 'true'],
        ['summary_loaded', 'true'],
      ]),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    })

    const snaps = getSessionSnapshots('admin-1')
    expect(snaps[0]!.configKeys).toEqual(['main_model'])
  })
})
