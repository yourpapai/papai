// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// alert-state.ts binds `const log = logger.child(...)` at module load, so we
// install a tracked logger mock and import the module through a cachebuster
// query (mirroring tests/deferred-prompts/tool-handlers-logging.test.ts) to
// get a fresh binding that resolves the mocked logger.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { setupTestDb } from '../utils/test-helpers.js'

type AlertStateModule = typeof import('../../src/deferred-prompts/alert-state.js')

const importAlertState = (): Promise<AlertStateModule> =>
  import(`../../src/deferred-prompts/alert-state.js?test=${crypto.randomUUID()}`)

const USER_ID = 'alerts-log-test-user'

const tracked: TrackedLoggerMock = createTrackedLoggerMock()

beforeEach(async () => {
  tracked.clearCalls()
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  await setupTestDb()
})

describe('alerts logging', () => {
  test('updateAlertActivityState logs the cursor entry and the state update', async () => {
    const { updateAlertActivityState } = await importAlertState()
    updateAlertActivityState('alert-1', USER_ID, null, 'cursor-1')

    const debugArgs = tracked.getCallsByLevel('debug').map((c) => c.args)
    expect(debugArgs).toContainEqual([
      { id: 'alert-1', userId: USER_ID, lastTriggeredAt: null, lastActivityCursor: 'cursor-1' },
      'updateAlertActivityState called',
    ])
    const infoArgs = tracked.getCallsByLevel('info').map((c) => c.args)
    expect(infoArgs).toContainEqual([{ id: 'alert-1', userId: USER_ID }, 'Alert activity state updated'])
  })
})
