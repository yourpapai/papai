// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for the who-may-use gate in src/llm-orchestrator-tools.ts as it applies
 * to plugin_nerv__* action tools. Mirrors the acp coverage in
 * tests/llm-orchestrator-tools-who-may-use.test.ts, reusing its ToolSet-construction
 * approach (ai's `tool()` helper) to stay strict-oxlint-clean.
 */

import { expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { applyWhoMayUseFilter } from '../../../src/llm-orchestrator-tools.js'

const stub = (): ToolSet[string] =>
  tool({ description: '', inputSchema: z.object({}), execute: () => Promise.resolve(null) })

const NAMES = [
  'plugin_nerv__create_coding_task',
  'plugin_nerv__followup_coding_task',
  'plugin_nerv__cancel_coding_task',
  'plugin_nerv__coding_task_status',
  'plugin_nerv__list_coding_tasks',
]

const makeToolSet = (names: string[]): ToolSet => {
  const out: ToolSet = {}
  for (const name of names) out[name] = stub()
  return out
}

test('off-allowlist actor loses nerv action tools but keeps status/list', () => {
  const filtered = applyWhoMayUseFilter(makeToolSet(NAMES), ['alice'], 'bob')
  expect(Object.keys(filtered).sort()).toEqual(['plugin_nerv__coding_task_status', 'plugin_nerv__list_coding_tasks'])
})

test('allowlisted actor keeps all nerv tools', () => {
  const filtered = applyWhoMayUseFilter(makeToolSet(NAMES), ['bob'], 'bob')
  expect(Object.keys(filtered).length).toBe(5)
})

test('members default keeps everything (reference-identical)', () => {
  const ts = makeToolSet(NAMES)
  expect(applyWhoMayUseFilter(ts, 'members', 'bob')).toBe(ts)
})
