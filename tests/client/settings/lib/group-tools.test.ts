// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ToolEntry } from '../../../../client/settings/fetcher-schemas-tools.js'
import { groupSummary, groupToolEntries } from '../../../../client/settings/lib/group-tools.js'

const entry = (name: string, permission: ToolEntry['permission'], group?: string): ToolEntry => ({
  name,
  permission,
  risk: 'open-world',
  ...(group === undefined ? {} : { group }),
})

describe('groupToolEntries', () => {
  test('puts ungrouped tools first, then groups sorted by label', () => {
    const groups = groupToolEntries([
      entry('plugin_b__t', 'allow', 'b-plugin'),
      entry('get_current_time', 'allow'),
      entry('plugin_a__t', 'allow', 'a-plugin'),
      entry('plugin_a__u', 'ask', 'a-plugin'),
    ])
    expect(groups.map((g) => g.group)).toEqual([null, 'a-plugin', 'b-plugin'])
    expect(groups[1]!.tools.map((t) => t.name)).toEqual(['plugin_a__t', 'plugin_a__u'])
  })

  test('omits the ungrouped bucket when every tool has a group', () => {
    const groups = groupToolEntries([entry('plugin_a__t', 'allow', 'a-plugin')])
    expect(groups.map((g) => g.group)).toEqual(['a-plugin'])
  })

  test('returns a single ungrouped bucket for builtin-only domains', () => {
    const groups = groupToolEntries([entry('get_current_time', 'allow')])
    expect(groups.map((g) => g.group)).toEqual([null])
  })
})

describe('groupSummary', () => {
  test('returns the shared permission when uniform', () => {
    expect(groupSummary([entry('a', 'ask', 'g'), entry('b', 'ask', 'g')])).toBe('ask')
  })

  test('returns partial when permissions diverge', () => {
    expect(groupSummary([entry('a', 'allow', 'g'), entry('b', 'deny', 'g')])).toBe('partial')
  })
})
