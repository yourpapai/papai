// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// proof-check-run.ts binds `const log = logger.child(...)` at module load, so we
// install a tracked logger mock and import the module through a cachebuster
// query to get a fresh binding that resolves the mocked logger (mirrors
// tests/deferred-prompts/tool-handlers-logging.test.ts).

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ProofCheckDeps } from '../../src/deferred-prompts/proof-checks.js'
import type { CreateResult } from '../../src/deferred-prompts/types.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { getToolExecutor, setupTestDb } from '../utils/test-helpers.js'

type ProofCheckRunModule = typeof import('../../src/tools/proof-check-run.js')

const importProofCheckRun = (): Promise<ProofCheckRunModule> =>
  import(`../../src/tools/proof-check-run.js?test=${crypto.randomUUID()}`)

const tracked: TrackedLoggerMock = createTrackedLoggerMock()

const fakeDeps = (): ProofCheckDeps => ({
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
  store: { append: () => Promise.resolve() },
  readRecentLlm: () => [],
  readCachedHistory: () => [],
})

beforeEach(async () => {
  tracked.clearCalls()
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  await setupTestDb()
})

const debugArgs = (): unknown[][] => tracked.getCallsByLevel('debug').map((c) => c.args)
const infoArgs = (): unknown[][] => tracked.getCallsByLevel('info').map((c) => c.args)

describe('run_proof_check tool logging', () => {
  test('binds the child logger with the tool:run-proof-check scope', async () => {
    await importProofCheckRun()
    expect(tracked.logger.child).toHaveBeenCalledWith({ scope: 'tool:run-proof-check' })
  })

  test('tool entry logs at debug, not info', async () => {
    const { makeRunProofCheckTool } = await importProofCheckRun()
    const execute = getToolExecutor(makeRunProofCheckTool('ctx-1', 'user-1', fakeDeps()))
    await execute({ cleanup: true })

    expect(debugArgs()).toContainEqual([
      { check: undefined, variant: undefined, cleanup: true },
      'run_proof_check called',
    ])
    expect(infoArgs().map((args) => args[1])).not.toContain('run_proof_check called')
  })

  test('check and variant params ride the debug entry line', async () => {
    const { makeRunProofCheckTool } = await importProofCheckRun()
    const execute = getToolExecutor(makeRunProofCheckTool('ctx-1', 'user-1', fakeDeps()))
    await execute({ check: 'bug4_create_response_mode', variant: 'scheduled' })

    expect(debugArgs()).toContainEqual([
      { check: 'bug4_create_response_mode', variant: 'scheduled', cleanup: false },
      'run_proof_check called',
    ])
    expect(infoArgs().map((args) => args[1])).not.toContain('run_proof_check called')
  })
})
