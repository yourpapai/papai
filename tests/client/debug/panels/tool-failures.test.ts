// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { describe, expect, test } from 'bun:test'

import { renderToolFailures } from '../../../../client/debug/panels/tool-failures.js'
import type { ToolFailure } from '../../../../src/debug/schemas.js'

function makeToolFailure(overrides: Partial<ToolFailure> = {}): ToolFailure {
  return {
    timestamp: 1700000000000,
    scope: { kind: 'user', userId: 'u1' },
    data: { toolName: 'create_task', error: 'timeout', retriable: true },
    ...overrides,
  }
}

describe('renderToolFailures', () => {
  test('returns placeholder when failures array is empty', () => {
    const html = renderToolFailures([], 'all')
    expect(html).toContain('placeholder')
    expect(html).toContain('No failures')
  })

  test('renders a single failure row', () => {
    const failure = makeToolFailure()
    const html = renderToolFailures([failure], 'all')
    expect(html).toContain('failure-row')
    expect(html).toContain('create_task')
    expect(html).toContain('timeout')
  })

  test('renders retriable flag', () => {
    const retriable = makeToolFailure({ data: { toolName: 't', error: 'e', retriable: true } })
    const html = renderToolFailures([retriable], 'all')
    expect(html).toContain('retriable')
  })

  test('renders non-retriable flag', () => {
    const nonRetriable = makeToolFailure({ data: { toolName: 't', error: 'e', retriable: false } })
    const html = renderToolFailures([nonRetriable], 'all')
    expect(html).toContain('non-retriable')
  })

  test('renders timestamp', () => {
    const failure = makeToolFailure({ timestamp: 1700000000000 })
    const html = renderToolFailures([failure], 'all')
    expect(html).toContain('failure-time')
  })

  test('filters by context when activeContext is not all', () => {
    const f1 = makeToolFailure({ scope: { kind: 'user', userId: 'u1' }, data: { toolName: 'tool1', error: 'e' } })
    const f2 = makeToolFailure({ scope: { kind: 'group', groupId: 'g1' }, data: { toolName: 'tool2', error: 'e' } })
    const html = renderToolFailures([f1, f2], 'dm')
    expect(html).toContain('tool1')
    expect(html).not.toContain('tool2')
  })

  test('escapes HTML in failure data', () => {
    const failure = makeToolFailure({ data: { toolName: '<b>bad</b>', error: '<script>xss</script>' } })
    const html = renderToolFailures([failure], 'all')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;b&gt;')
  })

  test('includes data-index attribute for click handling', () => {
    const failure = makeToolFailure()
    const html = renderToolFailures([failure], 'all')
    expect(html).toContain('data-index="0"')
  })
})
