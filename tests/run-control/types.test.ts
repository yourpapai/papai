// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RunAbortedError } from '../../src/run-control/types.js'

describe('RunAbortedError', () => {
  test('is an Error with the expected message and name', () => {
    const effects = [{ toolName: 'create_task' }]
    const err = new RunAbortedError(effects)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Run force-aborted by user')
    expect(err.name).toBe('RunAbortedError')
    expect(err.effects).toEqual(effects)
  })

  test('effects array is readable', () => {
    const err = new RunAbortedError([])
    expect(err.effects).toEqual([])
  })
})
