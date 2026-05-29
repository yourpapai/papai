// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, test } from 'bun:test'

import { buildDomainDrillView, buildDomainListView } from '../../src/commands/tool-config-view.js'
import { getToolPrefs, setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const AVAILABLE = ['create_task', 'update_task', 'search_tasks', 'delete_task', 'web_fetch', 'get_current_time']

describe('buildDomainListView', () => {
  it('lists domains present in the available set with on status by default', () => {
    const view = buildDomainListView('ctx', AVAILABLE, { domainDefaults: {}, toolOverrides: {} })
    expect(view.text).toContain('Tools')
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:dom:task:'))).toBe(true)
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:open:task:'))).toBe(true)
  })

  it('keeps domain callbacks within Telegram callback limits for long contexts', () => {
    const view = buildDomainListView('managed-group-context-with-realistic-long-id-12345', AVAILABLE, {
      domainDefaults: {},
      toolOverrides: {},
    })

    expect(view.buttons.every((b) => Buffer.byteLength(b.callbackData, 'utf8') <= 64)).toBe(true)
  })

  it('compacts oversized domain callbacks when the context still fits', () => {
    const view = buildDomainListView('managed-group-context-long-id-123456789012', AVAILABLE, {
      domainDefaults: {},
      toolOverrides: {},
    })

    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:d:'))).toBe(true)
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:o:'))).toBe(true)
    expect(view.buttons.every((b) => Buffer.byteLength(b.callbackData, 'utf8') <= 64)).toBe(true)
  })

  it('marks a partially-disabled domain', () => {
    const view = buildDomainListView('ctx', AVAILABLE, {
      domainDefaults: {},
      toolOverrides: { delete_task: 'deny' },
    })
    const taskRow = view.text.split('\n').find((l) => l.toLowerCase().includes('task'))
    expect(taskRow).toContain('🟡')
  })
})

describe('buildDomainDrillView', () => {
  it('renders per-tool buttons with risk labels for the domain', () => {
    const view = buildDomainDrillView('ctx', 'task', AVAILABLE, {
      domainDefaults: {},
      toolOverrides: {},
    })
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:tool:delete_task:'))).toBe(true)
    expect(view.text).toContain('⚠️')
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:back:'))).toBe(true)
  })

  it('keeps tool callbacks within Telegram callback limits for long contexts', () => {
    const view = buildDomainDrillView('managed-group-context-with-realistic-long-id-12345', 'task', AVAILABLE, {
      domainDefaults: {},
      toolOverrides: {},
    })

    expect(view.buttons.every((b) => Buffer.byteLength(b.callbackData, 'utf8') <= 64)).toBe(true)
  })

  it('compacts oversized tool callbacks when the context still fits', () => {
    const view = buildDomainDrillView('managed-group-context-long-id-123456789012', 'task', AVAILABLE, {
      domainDefaults: {},
      toolOverrides: {},
    })

    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:t:'))).toBe(true)
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:b:'))).toBe(true)
    expect(view.buttons.every((b) => Buffer.byteLength(b.callbackData, 'utf8') <= 64)).toBe(true)
  })
})

describe('tool-config-view tri-state markers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('shows ❓ when domain default is ask', () => {
    setToolPrefs('ctx-view-ask', { domainDefaults: { task: 'ask' }, toolOverrides: {} })
    const view = buildDomainListView('ctx-view-ask', ['create_task', 'delete_task'], getToolPrefs('ctx-view-ask'))
    expect(view.text).toContain('❓')
  })

  test('shows ⭕ when domain default is deny', () => {
    setToolPrefs('ctx-view-deny', { domainDefaults: { task: 'deny' }, toolOverrides: {} })
    const view = buildDomainListView('ctx-view-deny', ['create_task'], getToolPrefs('ctx-view-deny'))
    expect(view.text).toContain('⭕')
  })

  test('shows 🟡 when tools in the domain disagree', () => {
    setToolPrefs('ctx-view-partial', {
      domainDefaults: { task: 'allow' },
      toolOverrides: { delete_task: 'deny' },
    })
    const view = buildDomainListView(
      'ctx-view-partial',
      ['create_task', 'delete_task'],
      getToolPrefs('ctx-view-partial'),
    )
    expect(view.text).toContain('🟡')
  })

  test('drill view shows ❓ marker for ask tool', () => {
    setToolPrefs('ctx-view-tool-ask', { domainDefaults: {}, toolOverrides: { delete_task: 'ask' } })
    const view = buildDomainDrillView(
      'ctx-view-tool-ask',
      'task',
      ['create_task', 'delete_task'],
      getToolPrefs('ctx-view-tool-ask'),
    )
    expect(view.text).toContain('❓')
    expect(view.text).toContain('delete_task')
  })

  test('footer hint always present at the bottom of the domain list', () => {
    const view = buildDomainListView('ctx-view-footer', ['create_task'], getToolPrefs('ctx-view-footer'))
    expect(view.text).toContain('🟢 = always allowed')
    expect(view.text).toContain('❓ = ask each time')
    expect(view.text).toContain('⭕ = blocked')
  })
})
