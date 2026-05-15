// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleEditorCallback, startEditor } from '../../src/config-editor/handlers.js'
import { getEditorSession } from '../../src/config-editor/state.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config-editor back action', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('back removes the active session for the current user and target context', () => {
    startEditor('user-1', 'group-1', 'timezone')
    const result = handleEditorCallback('user-1', 'group-1', 'back')

    expect(result.handled).toBe(true)
    expect(getEditorSession('user-1', 'group-1')).toBeNull()
  })
})
