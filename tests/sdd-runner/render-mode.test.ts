// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { renderModeFor } from '../../sdd-runner/src/render-mode.js'
import type { Streams } from '../../sdd-runner/src/render-mode.js'

function streams(stdoutTty: boolean, stdinTty: boolean): Streams {
  return { stdout: { isTTY: stdoutTty }, stdin: { isTTY: stdinTty } }
}

describe('render-mode detection matrix (4.9)', () => {
  it('full TTY terminal → TUI', () => {
    expect(renderModeFor(streams(true, true), {})).toBe('tui')
  })

  it('stdout piped (even with TTY stdin) → line renderer', () => {
    expect(renderModeFor(streams(false, true), {})).toBe('line')
  })

  it('stdin piped (even with TTY stdout) → line renderer', () => {
    expect(renderModeFor(streams(true, false), {})).toBe('line')
  })

  it('CI env forces the line renderer even on a full TTY', () => {
    expect(renderModeFor(streams(true, true), { CI: 'true' })).toBe('line')
    expect(renderModeFor(streams(true, true), { CI: '1' })).toBe('line')
  })

  it('TERM=dumb forces the line renderer even on a full TTY', () => {
    expect(renderModeFor(streams(true, true), { TERM: 'dumb' })).toBe('line')
  })

  it('SDD_DEBUG=1 raises the line renderer altitude but never forces the TUI', () => {
    expect(renderModeFor(streams(false, false), { SDD_DEBUG: '1' })).toBe('line-debug')
    expect(renderModeFor(streams(true, true), { SDD_DEBUG: '1' })).toBe('tui')
  })
})
