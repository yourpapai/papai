// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GITHUB_CAPABILITIES, GITHUB_DEFAULT_BASE_URL } from '../../../plugins/task-provider-github/constants.js'

describe('GITHUB_CAPABILITIES', () => {
  test('equals exactly projects.list and projects.read', () => {
    expect(GITHUB_CAPABILITIES).toEqual(new Set(['projects.list', 'projects.read']))
  })
})

describe('GITHUB_DEFAULT_BASE_URL', () => {
  test('is the public GitHub REST API base', () => {
    expect(GITHUB_DEFAULT_BASE_URL).toBe('https://api.github.com')
  })
})
