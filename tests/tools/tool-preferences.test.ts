// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeTools } from '../../src/tools/index.js'
import { getToolMetadata } from '../../src/tools/tool-metadata.js'
import {
  applyPreset,
  clearToolPrefs,
  detectActivePreset,
  getDomainSummary,
  hasStoredToolPrefs,
  parseToolPrefs,
  PRESET_KEYS,
  PRESET_RISK_DEFAULTS,
  resolveToolPermission,
  serializeToolPrefs,
  setToolPrefs,
  type ToolPrefs,
} from '../../src/tools/tool-preferences.js'
import { cycleDomain, cycleTool, partitionToolNames } from '../../src/tools/tool-preferences.testing.js'
import type { MakeToolsOptions } from '../../src/tools/types.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const empty: ToolPrefs = { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

describe('parseToolPrefs', () => {
  it('returns empty prefs for null', () => {
    expect(parseToolPrefs(null)).toEqual(empty)
  })

  it('returns empty prefs for corrupt JSON', () => {
    expect(parseToolPrefs('{not json')).toEqual(empty)
  })

  it('coerces missing fields and drops non-array/object shapes', () => {
    expect(parseToolPrefs('{"domainDefaults":"web"}')).toEqual(empty)
  })

  it('round-trips a valid blob', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: { web: 'deny' },
      toolOverrides: { delete_task: 'deny' },
    }
    expect(parseToolPrefs(serializeToolPrefs(prefs))).toEqual(prefs)
  })
})

describe('resolveToolPermission (enabled/disabled semantics)', () => {
  it('defaults every tool to enabled with empty prefs', () => {
    expect(resolveToolPermission(empty, 'web_fetch')).not.toBe('deny')
    expect(resolveToolPermission(empty, 'delete_task')).not.toBe('deny')
  })

  it('disables every tool in a disabled domain', () => {
    const prefs: ToolPrefs = { domainDefaults: { web: 'deny' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'web_fetch')).toBe('deny')
  })

  it('lets a per-tool override win over the domain default (off within on domain)', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: { delete_task: 'deny' } }
    expect(resolveToolPermission(prefs, 'delete_task')).toBe('deny')
    expect(resolveToolPermission(prefs, 'create_task')).not.toBe('deny')
  })

  it('lets a per-tool override win over the domain default (on within off domain)', () => {
    const prefs: ToolPrefs = { domainDefaults: { web: 'deny' }, toolOverrides: { web_fetch: 'allow' } }
    expect(resolveToolPermission(prefs, 'web_fetch')).toBe('allow')
  })

  it('classifies plugin tools into the plugin domain', () => {
    expect(getToolMetadata('plugin_hello_world__greet')).toEqual({
      domain: 'plugin',
      operation: 'read',
      risk: 'open-world',
    })
  })

  it('denies plugin tools when the plugin domain is denied', () => {
    const prefs: ToolPrefs = { domainDefaults: { plugin: 'deny' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'plugin_hello_world__greet')).toBe('deny')
  })

  it('lets a per-tool override re-enable a plugin tool inside a denied plugin domain', () => {
    const prefs: ToolPrefs = {
      domainDefaults: { plugin: 'deny' },
      toolOverrides: { plugin_hello_world__greet: 'allow' },
    }
    expect(resolveToolPermission(prefs, 'plugin_hello_world__greet')).toBe('allow')
  })

  it('lets an override=deny disable a plugin tool when the plugin domain stays allowed', () => {
    const prefs: ToolPrefs = {
      domainDefaults: {},
      toolOverrides: { plugin_hello_world__greet: 'deny' },
    }
    expect(resolveToolPermission(prefs, 'plugin_hello_world__greet')).toBe('deny')
  })
})

describe('partitionToolNames (legacy)', () => {
  it('splits candidate names into exposed and denied sets', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: { delete_task: 'deny' } }
    const { exposed, denied } = partitionToolNames(prefs, ['create_task', 'delete_task', 'web_fetch'])
    expect([...exposed].sort()).toEqual(['create_task', 'web_fetch'])
    expect([...denied]).toEqual(['delete_task'])
  })
})

describe('serializeToolPrefs new shape', () => {
  test('round-trips through parse/serialize', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: { task: 'ask', project: 'deny' },
      toolOverrides: { delete_task: 'allow' },
    }
    const round = parseToolPrefs(serializeToolPrefs(prefs))
    expect(round).toEqual(prefs)
  })
})

describe('partitionToolNames', () => {
  test('separates deny from allow/ask', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: { delete_task: 'deny', create_task: 'ask' } }
    const { exposed, denied } = partitionToolNames(prefs, ['create_task', 'delete_task', 'list_tasks'])
    expect(exposed).toEqual(new Set(['create_task', 'list_tasks']))
    expect(denied).toEqual(new Set(['delete_task']))
  })
})

describe('resolveToolPermission', () => {
  test('returns "allow" when nothing is set (default)', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('uses domain default when no override', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'ask' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
  })

  test('per-tool override wins over domain default', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'deny' }, toolOverrides: { create_task: 'allow' } }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('unclassified tool (no metadata) ignores domainDefaults', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'deny' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'plugin_foo__bar')).toBe('allow')
  })

  test('unclassified tool honours its own override', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: { plugin_foo__bar: 'deny' } }
    expect(resolveToolPermission(prefs, 'plugin_foo__bar')).toBe('deny')
  })

  test('a legacy override on an old deferred-prompt name carries over to create_reminder', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_deferred_prompt: 'deny' },
    }
    expect(resolveToolPermission(prefs, 'create_reminder')).toBe('deny')
  })

  test('a legacy override carries over to create_alert', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_deferred_prompt: 'ask' },
    }
    expect(resolveToolPermission(prefs, 'create_alert')).toBe('ask')
  })

  test('a legacy override on list_deferred_prompts carries over to list_reminders', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { list_deferred_prompts: 'deny' },
    }
    expect(resolveToolPermission(prefs, 'list_reminders')).toBe('deny')
  })
})

describe('parseToolPrefs legacy migration', () => {
  test('legacy disabledDomains → domainDefaults deny', () => {
    const legacy = JSON.stringify({ disabledDomains: ['task', 'project'], toolOverrides: {} })
    const prefs = parseToolPrefs(legacy)
    expect(prefs.domainDefaults).toEqual({ task: 'deny', project: 'deny' })
    expect(prefs.toolOverrides).toEqual({})
  })

  test('legacy boolean overrides map to allow/deny', () => {
    const legacy = JSON.stringify({ disabledDomains: [], toolOverrides: { create_task: true, delete_task: false } })
    const prefs = parseToolPrefs(legacy)
    expect(prefs.toolOverrides).toEqual({ create_task: 'allow', delete_task: 'deny' })
  })

  test('new-shape strings pass through', () => {
    const fresh = JSON.stringify({
      domainDefaults: { task: 'ask' },
      toolOverrides: { delete_task: 'deny' },
    })
    const prefs = parseToolPrefs(fresh)
    expect(prefs.domainDefaults).toEqual({ task: 'ask' })
    expect(prefs.toolOverrides).toEqual({ delete_task: 'deny' })
  })

  test('unknown permission string → dropped', () => {
    const garbage = JSON.stringify({ domainDefaults: { task: 'maybe' }, toolOverrides: { x: 'sometimes' } })
    const prefs = parseToolPrefs(garbage)
    expect(prefs).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
  })

  test('null or empty input → empty prefs', () => {
    expect(parseToolPrefs(null)).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
    expect(parseToolPrefs('')).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
  })

  test('new-shape wins over legacy disabledDomains on conflict', () => {
    const mixed = JSON.stringify({
      disabledDomains: ['task'],
      domainDefaults: { task: 'ask' },
      toolOverrides: {},
    })
    const prefs = parseToolPrefs(mixed)
    expect(prefs.domainDefaults).toEqual({ task: 'ask' })
  })
})

describe('diagnostics domain (regression-only)', () => {
  test('parseToolPrefs preserves a diagnostics domainDefault instead of dropping the key', () => {
    const prefs = parseToolPrefs('{"domainDefaults":{"diagnostics":"ask"}}')
    expect(prefs.domainDefaults).toEqual({ diagnostics: 'ask' })
    expect(prefs.riskDefaults).toEqual({})
    expect(prefs.toolOverrides).toEqual({})
  })

  test('empty prefs resolve every tool to allow via resolveToolPermission', () => {
    for (const name of ['create_task', 'delete_task', 'web_fetch']) {
      expect(resolveToolPermission(empty, name)).toBe('allow')
    }
  })
})

describe('cycleTool', () => {
  test('cycles allow → ask → deny → allow', () => {
    let prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: {} }
    // allow → ask
    prefs = cycleTool(prefs, 'create_task')
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
    // ask → deny
    prefs = cycleTool(prefs, 'create_task')
    expect(resolveToolPermission(prefs, 'create_task')).toBe('deny')
    // deny → allow
    prefs = cycleTool(prefs, 'create_task')
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('prunes override when it matches the domain default', () => {
    let prefs: ToolPrefs = { domainDefaults: { task: 'ask' }, toolOverrides: { create_task: 'deny' } }
    // deny → allow (override stays; differs from default 'ask')
    prefs = cycleTool(prefs, 'create_task')
    expect(prefs.toolOverrides['create_task']).toBe('allow')
    // allow → ask (matches domain default → pruned)
    prefs = cycleTool(prefs, 'create_task')
    expect(prefs.toolOverrides['create_task']).toBeUndefined()
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
  })
})

describe('cycleDomain', () => {
  test('cycles domain default and clears per-tool overrides in that domain', () => {
    let prefs: ToolPrefs = {
      domainDefaults: { task: 'allow' },
      toolOverrides: { create_task: 'deny', save_memo: 'deny' },
    }
    prefs = cycleDomain(prefs, 'task', ['create_task', 'delete_task'])
    expect(prefs.domainDefaults['task']).toBe('ask')
    // create_task override is cleared because the domain bulk action wins
    expect(prefs.toolOverrides['create_task']).toBeUndefined()
    // save_memo is untouched (different domain)
    expect(prefs.toolOverrides['save_memo']).toBe('deny')
  })

  test('cycles allow → ask → deny → allow on the domain itself', () => {
    let prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: {} }
    prefs = cycleDomain(prefs, 'task', [])
    expect(prefs.domainDefaults['task']).toBe('ask')
    prefs = cycleDomain(prefs, 'task', [])
    expect(prefs.domainDefaults['task']).toBe('deny')
    prefs = cycleDomain(prefs, 'task', [])
    // pruned when returning to 'allow' default
    expect(prefs.domainDefaults['task']).toBeUndefined()
  })
})

describe('getDomainSummary', () => {
  test('returns allow/ask/deny when all tools share the same permission', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'ask' }, toolOverrides: {} }
    expect(getDomainSummary(prefs, 'task', ['create_task', 'delete_task'])).toBe('ask')
  })

  test('returns partial when tools disagree', () => {
    const prefs: ToolPrefs = {
      domainDefaults: { task: 'allow' },
      toolOverrides: { delete_task: 'deny' },
    }
    expect(getDomainSummary(prefs, 'task', ['create_task', 'delete_task'])).toBe('partial')
  })

  test('falls back to the domain default when name list is empty', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'deny' }, toolOverrides: {} }
    expect(getDomainSummary(prefs, 'task', [])).toBe('deny')
  })
})

describe('riskDefaults tier', () => {
  test('resolveToolPermission falls back to riskDefaults by tool risk', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    }
    // read risk → allow (no riskDefault for read)
    expect(resolveToolPermission(prefs, 'list_tasks')).toBe('allow')
    // write risk → ask
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
    // destructive risk → ask
    expect(resolveToolPermission(prefs, 'delete_task')).toBe('ask')
    // open-world risk → ask
    expect(resolveToolPermission(prefs, 'web_fetch')).toBe('ask')
  })

  test('domainDefaults wins over riskDefaults', () => {
    const prefs: ToolPrefs = { riskDefaults: { write: 'ask' }, domainDefaults: { task: 'allow' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('toolOverrides wins over both domain and risk defaults', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask' },
      domainDefaults: { task: 'deny' },
      toolOverrides: { create_task: 'allow' },
    }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('a new open-world tool (mcp_*) inherits the risk default', () => {
    const prefs: ToolPrefs = { riskDefaults: { 'open-world': 'ask' }, domainDefaults: {}, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'mcp_server__search')).toBe('ask')
  })

  test('round-trips riskDefaults through parse/serialize', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask', destructive: 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    }
    expect(parseToolPrefs(serializeToolPrefs(prefs))).toEqual(prefs)
  })

  test('legacy prefs without riskDefaults parse to riskDefaults: {}', () => {
    const legacy = JSON.stringify({ domainDefaults: { task: 'ask' }, toolOverrides: {} })
    expect(parseToolPrefs(legacy).riskDefaults).toEqual({})
  })

  test('cycleTool preserves an existing riskDefaults layer', () => {
    let prefs: ToolPrefs = { riskDefaults: { destructive: 'ask' }, domainDefaults: {}, toolOverrides: {} }
    prefs = cycleTool(prefs, 'create_task')
    expect(prefs.riskDefaults).toEqual({ destructive: 'ask' })
  })

  test('cycleDomain preserves an existing riskDefaults layer', () => {
    let prefs: ToolPrefs = { riskDefaults: { destructive: 'ask' }, domainDefaults: {}, toolOverrides: {} }
    prefs = cycleDomain(prefs, 'task', ['create_task', 'delete_task'])
    expect(prefs.riskDefaults).toEqual({ destructive: 'ask' })
  })
})

describe('applyPreset', () => {
  test('allow-all yields empty prefs', () => {
    expect(applyPreset('allow-all')).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
  })

  test('non-destructive asks on destructive + open-world only', () => {
    expect(applyPreset('non-destructive')).toEqual({
      riskDefaults: { destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    })
  })

  test('read-only asks on write + destructive + open-world', () => {
    expect(applyPreset('read-only')).toEqual({
      riskDefaults: { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    })
  })

  test('clears any prior domain/tool customization (reset-to-baseline)', () => {
    const result = applyPreset('read-only')
    expect(result.domainDefaults).toEqual({})
    expect(result.toolOverrides).toEqual({})
  })
})

describe('detectActivePreset', () => {
  test('empty prefs report allow-all', () => {
    expect(detectActivePreset({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })).toBe('allow-all')
  })

  test('PRESET_KEYS covers every key in PRESET_RISK_DEFAULTS', () => {
    expect(Object.keys(PRESET_RISK_DEFAULTS)).toEqual([...PRESET_KEYS])
  })

  test('matches each preset exactly', () => {
    for (const preset of PRESET_KEYS) {
      expect(detectActivePreset(applyPreset(preset))).toBe(preset)
    }
  })

  test('any domain override → Custom (null)', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: { task: 'deny' },
      toolOverrides: {},
    }
    expect(detectActivePreset(prefs)).toBeNull()
  })

  test('any tool override → Custom (null)', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: { delete_task: 'deny' },
    }
    expect(detectActivePreset(prefs)).toBeNull()
  })

  test('riskDefaults matching no preset → Custom (null)', () => {
    const prefs: ToolPrefs = { riskDefaults: { read: 'ask' }, domainDefaults: {}, toolOverrides: {} }
    expect(detectActivePreset(prefs)).toBeNull()
  })
})

describe('hasStoredToolPrefs', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('false when no row, true after a write', () => {
    expect(hasStoredToolPrefs('ctx-none')).toBe(false)
    setToolPrefs('ctx-none', { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: {} })
    expect(hasStoredToolPrefs('ctx-none')).toBe(true)
  })
})

describe('clearToolPrefs', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('after clear, hasStoredToolPrefs is false', () => {
    const ctx = 'ctx-clear-prefs-1'
    setToolPrefs(ctx, applyPreset('read-only'))
    expect(hasStoredToolPrefs(ctx)).toBe(true)

    clearToolPrefs(ctx)

    expect(hasStoredToolPrefs(ctx)).toBe(false)
  })
})

const READER_NAMES = ['read_recent_logs', 'read_llm_traces', 'read_recent_turns', 'read_recent_tool_failures'] as const

const readerDmOptions = (
  askPermission: MakeToolsOptions['askPermission'],
  overrides: Partial<MakeToolsOptions> = {},
): MakeToolsOptions => ({
  storageContextId: 'reader-prefs-ctx',
  chatUserId: 'reader-prefs-ctx',
  contextType: 'dm',
  mode: 'normal',
  isBotAdmin: true,
  askPermission,
  ...overrides,
})

describe('diagnostics reader family tool preferences', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('each reader registers as a read-risk diagnostics-domain tool', () => {
    for (const name of READER_NAMES) {
      expect(getToolMetadata(name)).toEqual({ domain: 'diagnostics', operation: 'read', risk: 'read' })
    }
  })

  test('a diagnostics domain deny resolves each reader to deny (domain tier)', () => {
    const prefs: ToolPrefs = { riskDefaults: {}, domainDefaults: { diagnostics: 'deny' }, toolOverrides: {} }
    for (const name of READER_NAMES) {
      expect(resolveToolPermission(prefs, name)).toBe('deny')
    }
  })

  test('a per-tool override wins over the diagnostics domain default for a reader', () => {
    const prefs: ToolPrefs = {
      riskDefaults: {},
      domainDefaults: { diagnostics: 'deny' },
      toolOverrides: { read_recent_logs: 'allow' },
    }
    expect(resolveToolPermission(prefs, 'read_recent_logs')).toBe('allow')
    expect(resolveToolPermission(prefs, 'read_llm_traces')).toBe('deny')
  })

  test('every preset leaves the readers allowed (read risk is never asked by presets)', () => {
    for (const preset of PRESET_KEYS) {
      for (const name of READER_NAMES) {
        expect(resolveToolPermission(applyPreset(preset), name)).toBe('allow')
      }
    }
  })

  test('a diagnostics domain deny removes each reader from the resolved ToolSet', async () => {
    const ctx = 'reader-prefs-deny-domain'
    setToolPrefs(ctx, { riskDefaults: {}, domainDefaults: { diagnostics: 'deny' }, toolOverrides: {} })

    const tools = await makeTools(
      createMockProvider(),
      readerDmOptions(undefined, { storageContextId: ctx, chatUserId: ctx }),
    )

    for (const name of READER_NAMES) expect(tools).not.toHaveProperty(name)
    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('a diagnostics domain ask wraps each reader: approval executes the tool', async () => {
    const ctx = 'reader-prefs-ask-approve'
    setToolPrefs(ctx, { riskDefaults: {}, domainDefaults: { diagnostics: 'ask' }, toolOverrides: {} })
    const decisions: string[] = []

    const tools = await makeTools(
      createMockProvider(),
      readerDmOptions(
        ({ toolName }) => {
          decisions.push(toolName)
          return Promise.resolve('allow' as const)
        },
        { storageContextId: ctx, chatUserId: ctx },
      ),
    )

    for (const name of READER_NAMES) expect(tools).toHaveProperty(name)
    const result: unknown = await getToolExecutor(tools['read_recent_logs']!)(
      { _permission_reason: 'check recent errors' },
      { toolCallId: 't1', messages: [], context: {} },
    )
    assert(isRecord(result))
    expect(result).not.toMatchObject({ status: 'permission_denied' })
    expect(decisions).toEqual(['read_recent_logs'])
  })

  test('a diagnostics domain ask wraps each reader: decline returns structured permission_denied', async () => {
    const ctx = 'reader-prefs-ask-decline'
    setToolPrefs(ctx, { riskDefaults: {}, domainDefaults: { diagnostics: 'ask' }, toolOverrides: {} })

    const tools = await makeTools(
      createMockProvider(),
      readerDmOptions(() => Promise.resolve('deny' as const), { storageContextId: ctx, chatUserId: ctx }),
    )

    const result: unknown = await getToolExecutor(tools['read_recent_turns']!)(
      { _permission_reason: 'inspect a stuck turn' },
      { toolCallId: 't2', messages: [], context: {} },
    )
    expect(result).toMatchObject({ status: 'permission_denied' })
  })

  test('implicit allow default exposes each reader unwrapped and directly executable', async () => {
    const ctx = 'reader-prefs-implicit-allow'

    const tools = await makeTools(
      createMockProvider(),
      readerDmOptions(undefined, { storageContextId: ctx, chatUserId: ctx }),
    )

    for (const name of READER_NAMES) expect(tools).toHaveProperty(name)
    const result: unknown = await getToolExecutor(tools['read_llm_traces']!)({})
    assert(isRecord(result))
    expect(result).not.toMatchObject({ status: 'permission_denied' })
  })
})
