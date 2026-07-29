// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseStoryRunnerArguments } from '../../scripts/story/cli.js'

describe('parseStoryRunnerArguments --coverage', () => {
  it('defaults coverage to false', () => {
    expect(parseStoryRunnerArguments([]).coverage).toBe(false)
  })

  it('sets coverage true and does not forward --coverage to the child', () => {
    const parsed = parseStoryRunnerArguments(['--coverage'])
    expect(parsed.coverage).toBe(true)
    expect(parsed.forwarded).not.toContain('--coverage')
  })
})
