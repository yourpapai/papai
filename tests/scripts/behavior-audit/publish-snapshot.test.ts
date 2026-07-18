// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  buildCommitMessage,
  formatDateStamp,
  resolveBranchName,
  resolveTagName,
} from '../../../scripts/behavior-audit/publish-snapshot.js'

describe('publish-snapshot helpers', () => {
  afterEach(() => {
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH']
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_TAG']
  })

  test('formatDateStamp formats UTC date as YYYY-MM-DD', () => {
    const date = new Date('2026-07-19T03:00:00Z')
    expect(formatDateStamp(date)).toBe('2026-07-19')
  })

  test('formatDateStamp uses UTC across timezones', () => {
    const date = new Date('2026-07-19T23:30:00Z')
    expect(formatDateStamp(date)).toBe('2026-07-19')
  })

  test('resolveBranchName returns audit-output by default', () => {
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH']
    expect(resolveBranchName()).toBe('audit-output')
  })

  test('resolveBranchName respects BEHAVIOR_AUDIT_PUBLISH_BRANCH', () => {
    process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH'] = 'custom-audit-branch'
    expect(resolveBranchName()).toBe('custom-audit-branch')
  })

  test('resolveTagName returns audit-output-latest by default', () => {
    delete process.env['BEHAVIOR_AUDIT_PUBLISH_TAG']
    expect(resolveTagName()).toBe('audit-output-latest')
  })

  test('buildCommitMessage formats date stamp', () => {
    expect(buildCommitMessage('2026-07-19')).toBe('chore(audit): snapshot for 2026-07-19')
  })
})
