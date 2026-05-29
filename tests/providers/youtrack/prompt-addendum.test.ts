// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { YOUTRACK_PROMPT_ADDENDUM } from '../../../plugins/task-provider-youtrack/prompt-addendum.js'

describe('YOUTRACK_PROMPT_ADDENDUM', () => {
  test('contains YouTrack-specific behaviors header', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('YouTrack-specific behaviors')
  })

  test('mentions State custom field', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('State')
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('custom field')
  })

  test('mentions human-readable issue IDs', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('PROJ-123')
  })

  test('mentions tags as labels', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Tags')
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('labels')
  })

  test('mentions work items', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Work items')
  })

  test('mentions sprints', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Sprints')
  })

  test('mentions watchers', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Watchers')
  })

  test('mentions votes', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Votes')
  })

  test('mentions visibility', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Visibility')
  })

  test('mentions teams', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Teams')
  })

  test('mentions reactions', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Reactions')
  })

  test('mentions saved queries', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Saved queries')
  })

  test('mentions activity history', () => {
    expect(YOUTRACK_PROMPT_ADDENDUM).toContain('Activity')
  })
})
