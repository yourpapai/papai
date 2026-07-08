// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeMcpPosture } from '../../../../../client/settings/sections/admin/mcp-posture.js'

describe('describeMcpPosture', () => {
  test('default allow, no exceptions → all tools', () => {
    expect(describeMcpPosture('allow', [])).toBe('All tools allowed.')
  })
  test('default allow with deny exceptions → all except', () => {
    expect(describeMcpPosture('allow', [{ tool: 'delete_repo', permission: 'deny' }])).toBe(
      'All tools allowed, except — blocked: delete_repo.',
    )
  })
  test('default deny, no exceptions → warns no tools', () => {
    expect(describeMcpPosture('deny', [])).toBe('⚠ No tools allowed on this server.')
  })
  test('default deny with allow exceptions → only these', () => {
    expect(
      describeMcpPosture('deny', [
        { tool: 'search', permission: 'allow' },
        { tool: 'get_issue', permission: 'allow' },
      ]),
    ).toBe('Only these tools — allowed: search, get_issue — all others blocked.')
  })
  test('default ask → confirm each, with exceptions', () => {
    expect(describeMcpPosture('ask', [{ tool: 'search', permission: 'allow' }])).toBe(
      'Every tool call must be confirmed (ask). Except — allowed: search.',
    )
  })
  test('blank tool names are ignored', () => {
    expect(describeMcpPosture('allow', [{ tool: '   ', permission: 'deny' }])).toBe('All tools allowed.')
  })
})
