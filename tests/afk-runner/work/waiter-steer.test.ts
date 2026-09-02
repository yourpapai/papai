// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { peekSteer, steerAnswers, steerLineOf, translateSteer } from '../../../afk-runner/src/work/waiter-steer.js'

describe('steer grammar — peek, translate, canonical line', () => {
  it('peekSteer parses the first non-empty line into the directive union', () => {
    expect(peekSteer('/nonexistent-run-dir/')).toBeNull()
  })

  it('steerLineOf canonicalizes each landing back to its directive line', () => {
    expect(steerLineOf({ kind: 'abort' })).toBe('abort')
    expect(steerLineOf({ kind: 'extend' })).toBe('extend')
    expect(steerLineOf({ kind: 'veto' })).toBe('veto')
    expect(steerLineOf({ kind: 'veto', redirect: 'redo the approach' })).toBe('veto redo the approach')
    expect(steerLineOf({ kind: 'veto', id: 'F99' })).toBe('veto F99=')
    expect(steerLineOf({ kind: 'veto', id: 'F99', redirect: 'drop it' })).toBe('veto F99=drop it')
    expect(steerLineOf({ kind: 'unknown', line: 'do the thing' })).toBe('do the thing')
  })

  it('translateSteer warns exactly on the invalid landings', () => {
    expect(translateSteer({ kind: 'extend' }, 'final').warn).toContain('not valid at a final gate')
    expect(translateSteer({ kind: 'veto' }, 'escalation').warn).toContain('not valid at an escalation gate')
    expect(translateSteer({ kind: 'extend' }, 'early').warn).toBeNull()
  })

  it('an item veto carries the trajectory ack; a gate-level veto does not', () => {
    expect(steerAnswers({ kind: 'veto', id: 'F1', redirect: 'r' }).acks).toHaveLength(1)
    expect(steerAnswers({ kind: 'veto' }).acks).toHaveLength(0)
  })
})
