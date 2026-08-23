// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GITHUB_PROMPT_ADDENDUM } from '../../../plugins/task-provider-github/prompt-addendum.js'

describe('GITHUB_PROMPT_ADDENDUM', () => {
  test('contains GitHub-specific behaviors header', () => {
    expect(GITHUB_PROMPT_ADDENDUM).toContain('GitHub-specific behaviors')
  })

  test('documents the two-state status model with folded close reason', () => {
    expect(GITHUB_PROMPT_ADDENDUM).toContain('open')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('closed')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('not_planned')
  })

  test('documents that priority and due/start dates are ignored', () => {
    expect(GITHUB_PROMPT_ADDENDUM).toContain('priority')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('due date')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('ignored')
  })

  test('documents assignees as GitHub logins', () => {
    expect(GITHUB_PROMPT_ADDENDUM).toContain('login')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('assignee')
  })

  test('documents that search honors GitHub search qualifiers', () => {
    expect(GITHUB_PROMPT_ADDENDUM).toContain('search qualifier')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('is:issue')
  })

  test('documents the single-repository project scope', () => {
    expect(GITHUB_PROMPT_ADDENDUM).toContain('one repository')
    expect(GITHUB_PROMPT_ADDENDUM).toContain('owner/repo')
  })
})
