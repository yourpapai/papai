// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ToolExecutionOptions, ToolSet } from 'ai'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import factory from '../../plugins/context-vault/index.js'
import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { applyPush } from '../../src/context-vault/spec-store.js'
import { contextVaultSpecs } from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import type { PluginContext, PluginRegistration } from '../../src/plugins/context.js'
import { namespacedToolName } from '../../src/plugins/contribution-names.js'
import { buildContextVaultFacade } from '../../src/plugins/context-vault-facade.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'
import { applyGuestReadOnlyFilter, applyToolPreferences } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const THREAD_CTX = toScopedThreadContextId({
  platformInstanceId: 'pi-test',
  nativeContextId: 'group-7',
  threadId: 'thread-3',
})
const CONFIG_CTX = getConfigContextIdFromStorageContextId(THREAD_CTX)
const PREFS_CTX = 'ctx-cv-prefs'

const LIST_WIRE = namespacedToolName('context-vault', 'list_agent_specs')
const GET_WIRE = namespacedToolName('context-vault', 'get_agent_spec')

const noEnqueue = { enqueueSummarization: (): void => undefined }

const seedSpec = (repo: string, changeName: string, mtime: number, done = false): void => {
  const files = done
    ? [
        { path: `a/${changeName}/proposal.md`, kind: 'proposal', hash: 'h1', mtime, text: `# ${changeName}\n\nbody` },
        { path: `a/${changeName}/tasks.md`, kind: 'tasks', hash: 'h2', mtime, text: '- [x] one\n- [x] two\n' },
      ]
    : [{ path: `a/${changeName}/proposal.md`, kind: 'proposal', hash: 'h1', mtime, text: `# ${changeName}\n\nbody` }]
  applyPush(CONFIG_CTX, { repo, changeName, files, deletions: [] }, noEnqueue)
}

const presetSummary = (specId: string, oneLine: string, summary: string): void => {
  getDrizzleDb()
    .update(contextVaultSpecs)
    .set({ oneLine, summary })
    .where(and(eq(contextVaultSpecs.configContextId, CONFIG_CTX), eq(contextVaultSpecs.id, specId)))
    .run()
}

const activatePlugin = (): Map<string, PluginTool> => {
  const tools = new Map<string, PluginTool>()
  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      tools.set(tool.name, tool)
    },
    registerPromptFragment: () => {},
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerAttachmentTransformer: () => {},
    registerTaskProviderType: () => {},
  }
  const ctx: PluginContext = {
    pluginId: 'context-vault',
    contextId: '__system__',
    permissions: new Set(['contextVault.read']),
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registration,
  }
  factory().activate(ctx)
  return tools
}

const requireTool = (tools: Map<string, PluginTool>, name: string): PluginTool => {
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(`tool ${name} was not registered`)
  return tool
}

const makeRuntimeCtx = (storageCtx: string): PluginToolRuntimeContext => ({
  pluginId: 'context-vault',
  storageContextId: storageCtx,
  chatUserId: 'user-1',
  kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
  adminConfig: { get: () => undefined },
  contextConfig: { get: () => undefined },
  rateLimit: { check: () => ({ allowed: true }) },
  attachments: { read: () => Promise.reject(new Error('not implemented')) },
  codingSecrets: {
    resolve: () => null,
    resolveForgeToken: () => null,
    resolveAgent: () => null,
    resolveForge: () => null,
    resolveProviderHost: () => null,
    resolveModel: () => null,
    resolveMcpServers: () => ({ ok: true, servers: [] }),
    resolveMcpTokens: () => ({}),
  },
  codingRepos: { list: () => [], get: () => null },
  contextVault: buildContextVaultFacade('context-vault', storageCtx, true),
})

const runTool = (tool: PluginTool, input: unknown, runtimeCtx: PluginToolRuntimeContext): Promise<unknown> =>
  tool.execute(input, runtimeCtx, { toolCallId: 'c1', messages: [], context: {} })

const toSdkTool = (tool: PluginTool, runtimeCtx: PluginToolRuntimeContext): NonNullable<ToolSet[string]> => {
  if (tool.inputSchema === undefined) throw new Error('tool must declare an inputSchema')
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: (input: unknown, opts: ToolExecutionOptions<unknown>) => tool.execute(input, runtimeCtx, opts),
  }
}

const ListOutputSchema = z.looseObject({
  specs: z.array(z.looseObject({ id: z.string() })),
  meta: z.looseObject({ lastPushAt: z.number().nullable() }),
})

describe('context-vault plugin tools', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('registers exactly list_agent_specs and get_agent_spec with JSON-schema inputs', () => {
    const tools = activatePlugin()
    expect([...tools.keys()].toSorted()).toEqual(['get_agent_spec', 'list_agent_specs'])

    const listSchema = z
      .looseObject({
        type: z.literal('object'),
        properties: z.looseObject({
          repo: z.looseObject({ type: z.literal('string') }),
          status: z.looseObject({ enum: z.array(z.string()) }),
          changedSince: z.looseObject({ type: z.literal('integer') }),
        }),
      })
      .parse(requireTool(tools, 'list_agent_specs').inputSchema)
    expect(listSchema.properties.status.enum).toEqual(['draft', 'approved', 'in-progress', 'done'])

    z.looseObject({
      type: z.literal('object'),
      properties: z.looseObject({ id: z.looseObject({ type: z.literal('string') }) }),
      required: z.tuple([z.literal('id')]),
    }).parse(requireTool(tools, 'get_agent_spec').inputSchema)
  })

  test('the tools reject invalid input', async () => {
    const tools = activatePlugin()
    const ctx = makeRuntimeCtx(THREAD_CTX)
    await expect(runTool(requireTool(tools, 'list_agent_specs'), { status: 'bogus' }, ctx)).rejects.toThrow(/status/u)
    await expect(runTool(requireTool(tools, 'list_agent_specs'), { repo: 5 }, ctx)).rejects.toThrow(/repo/u)
    await expect(runTool(requireTool(tools, 'get_agent_spec'), {}, ctx)).rejects.toThrow(/id/u)
  })

  test('list_agent_specs returns the spec read shape with freshness meta', async () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('papai', 'beta', 200, true)
    const tools = activatePlugin()

    const result = ListOutputSchema.parse(await runTool(requireTool(tools, 'list_agent_specs'), {}, makeRuntimeCtx(THREAD_CTX)))

    expect(result.specs.map((s) => s.id)).toEqual(['papai:alpha', 'papai:beta'])
    expect(result.specs[0]).toMatchObject({ repo: 'papai', name: 'alpha', stage: 'draft', progressPct: 0, mtime: 100 })
    expect(result.specs[1]).toMatchObject({ stage: 'done', progressPct: 100 })
    expect(typeof result.meta.lastPushAt).toBe('number')
  })

  test('list_agent_specs applies repo, status, and changedSince filters', async () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('papai', 'beta', 200, true)
    seedSpec('other', 'gamma', 300)
    const tools = activatePlugin()
    const list = requireTool(tools, 'list_agent_specs')
    const ctx = makeRuntimeCtx(THREAD_CTX)

    const byStatus = ListOutputSchema.parse(await runTool(list, { status: 'done' }, ctx))
    expect(byStatus.specs.map((s) => s.id)).toEqual(['papai:beta'])

    const byRepo = ListOutputSchema.parse(await runTool(list, { repo: 'other' }, ctx))
    expect(byRepo.specs.map((s) => s.id)).toEqual(['other:gamma'])

    const byChangedSince = ListOutputSchema.parse(await runTool(list, { changedSince: 150 }, ctx))
    expect(byChangedSince.specs.map((s) => s.id)).toEqual(['papai:beta', 'other:gamma'])
  })

  test('get_agent_spec returns summary, outline, stage, progress, and freshness meta', async () => {
    seedSpec('papai', 'alpha', 100)
    presetSummary('papai:alpha', 'vault one-liner', 'vault summary')
    const tools = activatePlugin()

    const result = await runTool(requireTool(tools, 'get_agent_spec'), { id: 'papai:alpha' }, makeRuntimeCtx(THREAD_CTX))

    expect(result).toMatchObject({
      ok: true,
      spec: {
        id: 'papai:alpha',
        oneLine: 'vault one-liner',
        summary: 'vault summary',
        outline: ['# alpha'],
        stage: 'draft',
        progressPct: 0,
        mtime: 100,
      },
    })
    z.looseObject({ ok: z.literal(true), meta: z.looseObject({ lastPushAt: z.number() }) }).parse(result)
  })

  test('get_agent_spec returns candidates for an ambiguous bare name and not-found otherwise', async () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('other', 'alpha', 300)
    const tools = activatePlugin()
    const get = requireTool(tools, 'get_agent_spec')
    const ctx = makeRuntimeCtx(THREAD_CTX)

    expect(await runTool(get, { id: 'alpha' }, ctx)).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates: ['other:alpha', 'papai:alpha'],
    })
    expect(await runTool(get, { id: 'papai:missing' }, ctx)).toEqual({ ok: false, reason: 'not-found' })
  })

  test('the tools run when the context has no task provider configured', async () => {
    seedSpec('papai', 'alpha', 100)
    const tools = activatePlugin()
    const ctx = makeRuntimeCtx(THREAD_CTX)
    expect(ctx.taskProvider).toBeUndefined()

    const result = ListOutputSchema.parse(await runTool(requireTool(tools, 'list_agent_specs'), {}, ctx))
    expect(result.specs.map((s) => s.id)).toEqual(['papai:alpha'])
  })

  test('tool_prefs deny removes the tools and allow passes them through', () => {
    const tools = activatePlugin()
    const ctx = makeRuntimeCtx(THREAD_CTX)
    const toolSet: ToolSet = {
      [LIST_WIRE]: toSdkTool(requireTool(tools, 'list_agent_specs'), ctx),
      [GET_WIRE]: toSdkTool(requireTool(tools, 'get_agent_spec'), ctx),
    }

    setToolPrefs(PREFS_CTX, { domainDefaults: {}, toolOverrides: { [LIST_WIRE]: 'deny' } })
    const denied = applyToolPreferences(toolSet, PREFS_CTX, undefined)
    expect(Object.keys(denied).toSorted()).toEqual([GET_WIRE])

    setToolPrefs(PREFS_CTX, { domainDefaults: {}, toolOverrides: {} })
    const allowed = applyToolPreferences(toolSet, PREFS_CTX, undefined)
    expect(allowed[LIST_WIRE]).toBe(toolSet[LIST_WIRE])
  })

  test('tool_prefs ask wraps execution in the confirmation flow', async () => {
    seedSpec('papai', 'alpha', 100)
    const tools = activatePlugin()
    const ctx = makeRuntimeCtx(THREAD_CTX)
    const toolSet: ToolSet = {
      [LIST_WIRE]: toSdkTool(requireTool(tools, 'list_agent_specs'), ctx),
    }
    setToolPrefs(PREFS_CTX, { domainDefaults: {}, toolOverrides: { [LIST_WIRE]: 'ask' } })

    const confirmed = applyToolPreferences(toolSet, PREFS_CTX, () => Promise.resolve('allow' as const))
    const confirmedExecute = confirmed[LIST_WIRE]?.execute
    if (confirmedExecute === undefined) throw new Error('ask-wrapped tool must keep execute')
    const out = ListOutputSchema.parse(
      await confirmedExecute({ _permission_reason: 'need spec status' }, { toolCallId: 't1', messages: [], context: {} }),
    )
    expect(out.specs.map((s) => s.id)).toEqual(['papai:alpha'])

    const noGate = applyToolPreferences(toolSet, PREFS_CTX, undefined)
    const deniedExecute = noGate[LIST_WIRE]?.execute
    if (deniedExecute === undefined) throw new Error('ask-wrapped tool must keep execute')
    const deniedOut: unknown = await deniedExecute(
      { _permission_reason: 'need spec status' },
      { toolCallId: 't2', messages: [], context: {} },
    )
    expect(deniedOut).toMatchObject({ status: 'permission_denied' })
  })

  test('both vault tools are eligible for the guest read-only toolset', () => {
    const tools = activatePlugin()
    const ctx = makeRuntimeCtx(THREAD_CTX)
    const toolSet: ToolSet = {
      [LIST_WIRE]: toSdkTool(requireTool(tools, 'list_agent_specs'), ctx),
      [GET_WIRE]: toSdkTool(requireTool(tools, 'get_agent_spec'), ctx),
      plugin_other__write_thing: toSdkTool(requireTool(tools, 'get_agent_spec'), ctx),
    }

    const guestTools = applyGuestReadOnlyFilter(toolSet)
    expect(Object.keys(guestTools).toSorted()).toEqual([GET_WIRE, LIST_WIRE])
  })
})
