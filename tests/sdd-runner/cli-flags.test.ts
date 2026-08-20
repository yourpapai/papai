// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { autonomyOverridesOf, parseTrailingFlags } from '../../sdd-runner/src/cli-flags.js'

describe('parseTrailingFlags', () => {
  it('parses autonomy, deadline, and verbosity together', () => {
    expect(parseTrailingFlags(['--autonomy', 'auto', '--auto-deadline', '5', '--verbosity', 'quiet'], 0)).toEqual({
      autonomy: 'auto',
      autoDeadlineMinutes: 5,
      verbosity: 'quiet',
    })
  })

  it('empty input yields an empty object and unknown flags throw', () => {
    expect(parseTrailingFlags([], 0)).toEqual({})
    expect(() => parseTrailingFlags(['--wat'], 0)).toThrow(/unknown flag: --wat/u)
    expect(() => parseTrailingFlags(['--verbosity', 'loud'], 0)).toThrow(/invalid --verbosity: loud/u)
  })

  it('autonomyOverridesOf shapes the orchestrator override object', () => {
    expect(autonomyOverridesOf(undefined, undefined)).toEqual({})
    expect(autonomyOverridesOf('assist', 10)).toEqual({ level: 'assist', deadlineMinutes: 10 })
  })
})
