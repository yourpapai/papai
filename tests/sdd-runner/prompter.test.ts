// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { stdinIsInteractive } from '../../sdd-runner/src/prompter.js'

describe('stdinIsInteractive', () => {
  it('is true when stdin reports a TTY and false otherwise', () => {
    expect(stdinIsInteractive({ isTTY: true })).toBe(true)
    expect(stdinIsInteractive({})).toBe(false)
  })
})
