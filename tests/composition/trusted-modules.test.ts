// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { TRUSTED_MODULES } from '../../src/composition/trusted-modules.js'
import { codingModule } from '../../src/modules/coding/module.js'
import { taskTrackerModule } from '../../src/modules/task-tracker/module.js'

describe('TRUSTED_MODULES', () => {
  test('registers the coding and task-tracker modules', () => {
    expect(TRUSTED_MODULES).toHaveLength(2)
    expect(TRUSTED_MODULES).toContain(codingModule)
    expect(TRUSTED_MODULES).toContain(taskTrackerModule)
  })
})
