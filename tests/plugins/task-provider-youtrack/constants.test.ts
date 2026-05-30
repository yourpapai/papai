// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ISSUE_FIELDS, YOUTRACK_CAPABILITIES } from '../../../plugins/task-provider-youtrack/constants.js'

describe('YOUTRACK_CAPABILITIES', () => {
  test('includes projects.delete capability', () => {
    expect(YOUTRACK_CAPABILITIES.has('projects.delete')).toBe(true)
  })

  test('includes Phase 4 collaboration capabilities', () => {
    expect(YOUTRACK_CAPABILITIES.has('tasks.watchers')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('tasks.votes')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('tasks.visibility')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('comments.reactions')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('projects.team')).toBe(true)
  })

  test('requests custom fields without duplicate scalar value selector', () => {
    expect(ISSUE_FIELDS).toContain(
      'customFields($type,name,value($type,id,name,login,fullName,localizedName,minutes,presentation,text))',
    )
    expect(ISSUE_FIELDS).not.toContain('customFields($type,name,value,value(')
  })
})
