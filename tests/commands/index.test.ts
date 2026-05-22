// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, test } from 'bun:test'
import assert from 'node:assert/strict'

import * as commands from '../../src/commands/index.js'

describe('commands/index exports', () => {
  test('exports registerContextCommand', () => {
    assert(typeof commands.registerContextCommand === 'function')
  })
})
