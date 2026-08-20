// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { applyGuestReadOnlyFilter, makeTools } from '../../src/tools/index.js'
import type { MakeToolsOptions } from '../../src/tools/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'diag-gate-user'

const adminDmOptions = (overrides: Partial<MakeToolsOptions> = {}): MakeToolsOptions => ({
  storageContextId: CONTEXT,
  chatUserId: CONTEXT,
  contextType: 'dm',
  mode: 'normal',
  isBotAdmin: true,
  platformInstanceId: 'pi-diag',
  ...overrides,
})

describe('run_diagnostics gate matrix', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an admin DM normal-mode toolset exposes run_diagnostics', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions())

    expect(tools).toHaveProperty('run_diagnostics')
  })

  test('isBotAdmin false excludes run_diagnostics', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('omitting isBotAdmin excludes run_diagnostics', async () => {
    const tools = await makeTools(
      createMockProvider(),
      adminDmOptions({ isBotAdmin: undefined, platformInstanceId: undefined }),
    )

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('a group context excludes run_diagnostics even for an admin', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ contextType: 'group' }))

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('proactive mode excludes run_diagnostics even for an admin DM', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: 'proactive' }))

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('a guest-filtered toolset never contains run_diagnostics', async () => {
    const descriptors = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    const guestTools = applyGuestReadOnlyFilter(descriptors)

    expect(guestTools).not.toHaveProperty('run_diagnostics')
  })
})
