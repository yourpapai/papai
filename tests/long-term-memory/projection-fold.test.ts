// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { type FoldCandidate, projectionKeyFor, winsAgainst } from '../../src/long-term-memory/projection-fold.js'

const at = (eventTime: string, idempotencyIdentity = 'ident-b'): FoldCandidate => ({ eventTime, idempotencyIdentity })

const EARLY = '2026-08-01T00:00:00.000Z'
const LATE = '2026-08-02T00:00:00.000Z'

describe('projectionKeyFor', () => {
  test('a record id is the key when the event has one', () => {
    expect(projectionKeyFor('rec-1', 'ident-1')).toBe('rec-1')
  })

  test('the idempotency identity is the key when the record id is null', () => {
    expect(projectionKeyFor(null, 'ident-1')).toBe('ident-1')
  })
})

describe('winsAgainst', () => {
  // Both sides carry distinct identities, chosen so the identity tie-break would push the
  // opposite way: these assert that event time dominates it, not merely that something wins.
  test('a later event time wins even when its identity sorts later', () => {
    expect(winsAgainst(at(LATE, 'ident-z'), at(EARLY, 'ident-a'))).toBe(true)
  })

  test('an earlier event time loses even when its identity sorts earlier', () => {
    expect(winsAgainst(at(EARLY, 'ident-a'), at(LATE, 'ident-z'))).toBe(false)
  })

  test('equal event times break on idempotency identity ascending', () => {
    expect(winsAgainst(at(EARLY, 'ident-a'), at(EARLY, 'ident-b'))).toBe(true)
    expect(winsAgainst(at(EARLY, 'ident-b'), at(EARLY, 'ident-a'))).toBe(false)
  })

  test('the same identity always wins against itself, so a re-apply refreshes the row', () => {
    expect(winsAgainst(at(EARLY, 'ident-a'), at(EARLY, 'ident-a'))).toBe(true)
    expect(winsAgainst(at(LATE, 'ident-a'), at(EARLY, 'ident-a'))).toBe(true)
  })

  test('the same instant written in different ISO forms is a tie, not an ordering', () => {
    expect(winsAgainst(at('2026-08-01T00:00:00Z', 'ident-a'), at('2026-08-01T00:00:00.000Z', 'ident-b'))).toBe(true)
    expect(winsAgainst(at('2026-08-01T00:00:00Z', 'ident-c'), at('2026-08-01T00:00:00.000Z', 'ident-b'))).toBe(false)
  })

  test('an unparsable candidate never wins, so a bad timestamp cannot displace a good row', () => {
    expect(winsAgainst(at('not-a-date', 'ident-a'), at(EARLY, 'ident-b'))).toBe(false)
  })

  test('an unparsable incumbent is always displaced', () => {
    expect(winsAgainst(at(EARLY, 'ident-b'), at('not-a-date', 'ident-a'))).toBe(true)
  })
})
