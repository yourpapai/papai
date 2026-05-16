// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { renderLogDetailHTML, renderLogDetailTitle } from '../../../client/debug/log-detail.js'
import type { LogEntry } from '../../../src/debug/schemas.js'

describe('renderLogDetailHTML', () => {
  it('should render log detail HTML', () => {
    const entry: LogEntry = {
      time: 1234567890,
      level: 30,
      msg: 'Test message',
      scope: 'test-scope',
    }

    const html = renderLogDetailHTML(entry, 0)

    expect(html).toContain('Test message')
    expect(html).toContain('test-scope')
  })

  it('should render with extra properties', () => {
    const entry: LogEntry = {
      time: 1234567890,
      level: 30,
      msg: 'Test',
      extraField: 'extraValue',
    }

    const html = renderLogDetailHTML(entry, 0)

    expect(html).toContain('extraField')
    expect(html).toContain('extraValue')
  })
})

describe('renderLogDetailTitle', () => {
  it('should render log entry title', () => {
    expect(renderLogDetailTitle(0)).toBe('Log Entry #1')
    expect(renderLogDetailTitle(5)).toBe('Log Entry #6')
  })
})
