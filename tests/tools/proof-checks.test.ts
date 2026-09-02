// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Tool } from 'ai'
import { z } from 'zod'

import { PROOF_CHECKS, resetProofChecksForTest, type ProofCheckDeps } from '../../src/deferred-prompts/proof-checks.js'
import type { ProofCheckRecord } from '../../src/deferred-prompts/proof-store.js'
import type { CreateResult } from '../../src/deferred-prompts/types.js'
import { maybeAddDiagnosticsTools } from '../../src/tools/diagnostics.js'
import { applyGuestReadOnlyFilter, makeTools } from '../../src/tools/index.js'
import { makeRunProofCheckTool } from '../../src/tools/proof-check-run.js'
import type { MakeToolsOptions } from '../../src/tools/types.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'proof-gate-user'
const PROOF_TOOLS = ['run_proof_check', 'read_proof_results'] as const

const adminDmOptions = (overrides: Partial<MakeToolsOptions> = {}): MakeToolsOptions => ({
  storageContextId: CONTEXT,
  chatUserId: CONTEXT,
  contextType: 'dm',
  mode: 'normal',
  isBotAdmin: true,
  platformInstanceId: 'pi-proof',
  ...overrides,
})

const makeFakeProofDeps = (overrides: Partial<ProofCheckDeps> = {}): ProofCheckDeps => ({
  now: () => 1_700_000_000_000,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  executeCreate: (): CreateResult => ({ error: 'unused' }),
  executeUpdate: () => ({ error: 'unused' }),
  executeGet: () => ({ error: 'unused' }),
  executeCancel: () => ({ error: 'unused' }),
  listScheduledPrompts: () => [],
  listAlertPrompts: () => [],
  getScheduledPrompt: () => null,
  getAlertPrompt: () => null,
  store: { append: () => Promise.resolve(), load: () => Promise.resolve([]) },
  readRecentLlm: () => [],
  readCachedHistory: () => [],
  ...overrides,
})

const createdWithExecutionMode = (): CreateResult =>
  ({
    status: 'created',
    type: 'scheduled',
    id: 'sp-1',
    fireAt: '2026-01-01T00:00:00.000Z',
    rrule: null,
    execution: { mode: 'scheduled' },
  }) as CreateResult

const getInputFieldDescription = (schema: unknown, fieldName: string): string | undefined => {
  if (!(schema instanceof z.ZodType)) return undefined
  const jsonSchema = z.toJSONSchema(schema)
  if (!('properties' in jsonSchema) || jsonSchema.properties === undefined) return undefined
  const property = jsonSchema.properties[fieldName]
  if (property === undefined || typeof property !== 'object' || property === null) return undefined
  return 'description' in property && typeof property.description === 'string' ? property.description : undefined
}

describe('proof-check tools gate matrix', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an admin DM normal-mode toolset exposes both proof tools', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions())

    for (const name of PROOF_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('an admin DM toolset exposes both proof tools when mode is omitted (orchestrator descriptor-cache path)', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: undefined }))

    for (const name of PROOF_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('isBotAdmin false excludes both proof tools', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    for (const name of PROOF_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('omitting isBotAdmin excludes both proof tools', async () => {
    const tools = await makeTools(
      createMockProvider(),
      adminDmOptions({ isBotAdmin: undefined, platformInstanceId: undefined }),
    )

    for (const name of PROOF_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('a group context excludes both proof tools even for an admin', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ contextType: 'group' }))

    for (const name of PROOF_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('proactive mode excludes both proof tools even for an admin DM', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: 'proactive' }))

    for (const name of PROOF_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('a guest-filtered toolset never contains the proof tools', async () => {
    const descriptors = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    const guestTools = applyGuestReadOnlyFilter(descriptors)

    for (const name of PROOF_TOOLS) expect(guestTools).not.toHaveProperty(name)
  })
})

describe('run_proof_check input schema', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('accepts check-only, cleanup-only, and empty inputs and pins the 15-minute wait cap', () => {
    const tool = makeRunProofCheckTool('sc-admin', 'chat-admin', makeFakeProofDeps())

    expect(schemaValidates(tool, {})).toBe(true)
    expect(schemaValidates(tool, { check: 'bug2_context_time' })).toBe(true)
    expect(schemaValidates(tool, { cleanup: true })).toBe(true)
    expect(schemaValidates(tool, { check: 'bug3_fires_on_creation', variant: 'alert' })).toBe(true)
    expect(schemaValidates(tool, { check: 'bug1_delivery_matches_execution', variant: 'with_tool_probe' })).toBe(true)
    expect(schemaValidates(tool, { check: 'bug2_context_time', wait_seconds: 900 })).toBe(true)
    expect(schemaValidates(tool, { check: 'not-a-check' })).toBe(false)
    expect(schemaValidates(tool, { check: 'bug2_context_time', cleanup: true })).toBe(false)
    expect(schemaValidates(tool, { check: 'bug2_context_time', wait_seconds: 901 })).toBe(false)
    expect(schemaValidates(tool, { check: 'bug2_context_time', wait_seconds: 0 })).toBe(false)
    expect(schemaValidates(tool, { check: 'bug2_context_time', wait_seconds: 12.5 })).toBe(false)
  })

  test('the check enum description names every check id', () => {
    const tool = makeRunProofCheckTool('sc-admin', 'chat-admin', makeFakeProofDeps())

    const description = getInputFieldDescription(tool.inputSchema, 'check')

    expect(description).toBeDefined()
    expect(description).toContain('bug1_delivery_matches_execution')
    expect(description).toContain('bug2_context_time')
    expect(description).toContain('bug3_fires_on_creation')
    expect(description).toContain('bug4_create_response_mode')
    expect(description).toContain('bug5_update_preserves_prompt')
  })

  test('the check enum accepts exactly the five registry ids', () => {
    const tool = makeRunProofCheckTool('sc-admin', 'chat-admin', makeFakeProofDeps())

    for (const id of Object.keys(PROOF_CHECKS)) expect(schemaValidates(tool, { check: id })).toBe(true)
  })
})

describe('run_proof_check execution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetProofChecksForTest()
  })

  test('a sync check returns the finished record inline', async () => {
    const appended: ProofCheckRecord[] = []
    const deps = makeFakeProofDeps({
      executeCreate: () => createdWithExecutionMode(),
      store: {
        append: (record: ProofCheckRecord): Promise<void> => {
          appended.push(record)
          return Promise.resolve()
        },
        load: () => Promise.resolve([]),
      },
    })
    const tool = makeRunProofCheckTool('sc-admin', 'chat-admin', deps)

    const result: unknown = await getToolExecutor(tool)({ check: 'bug4_create_response_mode' })

    expect(result).toMatchObject({
      status: 'completed',
      record: { check: 'bug4_create_response_mode', verdict: 'pass', run_id: appended[0]?.run_id },
    })
    expect(appended).toHaveLength(1)
    expect(appended[0]?.verdict).toBe('pass')
  })

  test('an async check returns the started outcome with a run id', async () => {
    const deps = makeFakeProofDeps({
      executeCreate: (): CreateResult => ({
        status: 'created',
        type: 'scheduled',
        id: 'sp-1',
        fireAt: '2026-01-01T00:00:00.000Z',
        rrule: null,
      }),
    })
    const tool = makeRunProofCheckTool('sc-admin', 'chat-admin', deps)

    const result: unknown = await getToolExecutor(tool)({ check: 'bug2_context_time' })

    expect(result).toMatchObject({ status: 'started' })
    expect(result).toHaveProperty('run_id')
  })

  test('a second concurrent async run degrades to the structured busy outcome', async () => {
    const deps = makeFakeProofDeps({
      executeCreate: (): CreateResult => ({
        status: 'created',
        type: 'scheduled',
        id: 'sp-1',
        fireAt: '2026-01-01T00:00:00.000Z',
        rrule: null,
      }),
    })
    const tool = makeRunProofCheckTool('sc-admin', 'chat-admin', deps)

    const first: unknown = await getToolExecutor(tool)({ check: 'bug2_context_time' })
    const second: unknown = await getToolExecutor(tool)({ check: 'bug2_context_time' })

    expect(first).toMatchObject({ status: 'started' })
    expect(second).toEqual({ status: 'busy' })
  })

  test('a missing bound id degrades to the structured error outcome', async () => {
    const tool = makeRunProofCheckTool('', '', makeFakeProofDeps())

    const result: unknown = await getToolExecutor(tool)({ check: 'bug4_create_response_mode' })

    expect(result).toEqual({
      status: 'error',
      error: 'run_proof_check requires the bound storage context and chat user ids.',
    })
  })
})

describe('proof tools assembly binding', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetProofChecksForTest()
  })

  test('maybeAddDiagnosticsTools assembles both tools and an empty binding degrades to the structured error', async () => {
    const tools: Record<string, Tool> = {}
    maybeAddDiagnosticsTools(tools, adminDmOptions({ storageContextId: undefined, chatUserId: undefined }))

    expect(tools).toHaveProperty('run_proof_check')
    expect(tools).toHaveProperty('read_proof_results')

    const result: unknown = await getToolExecutor(tools['run_proof_check']!)({ check: 'bug4_create_response_mode' })

    expect(result).toEqual({
      status: 'error',
      error: 'run_proof_check requires the bound storage context and chat user ids.',
    })
  })
})
