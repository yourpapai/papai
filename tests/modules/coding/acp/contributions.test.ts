// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../../../src/chat/scoped-context.js'
import {
  ACP_COMMAND_TEXT,
  ACP_PROMPT_FRAGMENT,
  codingAcpCommand,
  codingAcpPromptFragment,
  codingAcpSettingsSection,
  codingAcpTools,
  isCodingContextEligible,
} from '../../../../src/modules/coding/acp/contributions.js'
import { upsertRepo } from '../../../../src/modules/coding/repos/store.js'
import { setupTestDb } from '../../../utils/test-helpers.js'

const EXPECTED_TOOLS = [
  'list_projects',
  'list_agents',
  'start_session',
  'list_sessions',
  'session_status',
  'finish_session',
  'cancel_session',
  'answer_permission',
  'continue_session',
]
const OPERATOR_GATED = new Set([
  'start_session',
  'finish_session',
  'cancel_session',
  'answer_permission',
  'continue_session',
])

describe('coding acp contributions', () => {
  it('contributes all nine tools with a zod inputSchema', () => {
    expect(codingAcpTools.map((t) => t.name)).toEqual(EXPECTED_TOOLS)
    for (const t of codingAcpTools) expect(typeof t.inputSchema.safeParse).toBe('function')
  })

  it('marks exactly the lifecycle-mutating tools as operator-gated', () => {
    for (const t of codingAcpTools) {
      expect(t.gate === 'operator').toBe(OPERATOR_GATED.has(t.name))
    }
  })

  it('declares the acp command + hint fragment with the verbatim text', () => {
    expect(codingAcpCommand.name).toBe('acp')
    expect(codingAcpPromptFragment.name).toBe('acp-hint')
    expect(codingAcpPromptFragment.content).toBe(ACP_PROMPT_FRAGMENT)
    expect(ACP_PROMPT_FRAGMENT.length).toBeGreaterThan(0)
    expect(ACP_PROMPT_FRAGMENT.length).toBeLessThanOrEqual(2000)
    expect(ACP_COMMAND_TEXT.length).toBeGreaterThan(0)
  })

  it('declares the acp magi settings section (token sensitive)', () => {
    expect(codingAcpSettingsSection.id).toBe('acp')
    const keys = codingAcpSettingsSection.fields.map((f) => f.key)
    expect(keys).toEqual(['magi_base_url', 'magi_token'])
    const token = codingAcpSettingsSection.fields.find((f) => f.key === 'magi_token')
    expect(token?.sensitive).toBe(true)
  })

  it('is eligible only where the config-context repo catalogue is non-empty', async () => {
    await setupTestDb()
    const ctx = toScopedThreadContextId({ platformInstanceId: 'tg', nativeContextId: 'group7', threadId: 'thread-1' })
    expect(isCodingContextEligible(ctx)).toBe(false)
    upsertRepo(
      getConfigContextIdFromStorageContextId(ctx),
      { name: 'demo', repoUrl: 'https://github.com/x/y', baseBranch: 'main', permissionPreset: 'cautious' },
      'admin',
    )
    expect(isCodingContextEligible(ctx)).toBe(true)
  })
})
