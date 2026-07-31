// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { systemError } from '../../src/errors.js'
import { toolErrorClass, toolFailureMeta } from '../../src/tools/tool-logging.js'

describe('toolErrorClass', () => {
  test('returns the closed AppError code for app errors', () => {
    expect(toolErrorClass(systemError.configMissing('X'))).toBe('config-missing')
  })

  test('returns the constructor name for plain errors, never the message', () => {
    expect(toolErrorClass(new TypeError('canary-message-content'))).toBe('TypeError')
    expect(toolErrorClass(new Error('canary-message-content'))).toBe('Error')
  })

  test('returns non_error for non-error throws', () => {
    expect(toolErrorClass('canary-string-throw')).toBe('non_error')
    expect(toolErrorClass(null)).toBe('non_error')
  })
})

describe('toolFailureMeta', () => {
  test('emits only the tool enum and the controlled error class', () => {
    const meta = toolFailureMeta('create_task', new Error('canary provider payload'))
    expect(meta).toEqual({ tool: 'create_task', errorClass: 'Error' })
    expect(JSON.stringify(meta)).not.toContain('canary')
  })
})
