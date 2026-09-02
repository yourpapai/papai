// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { Finding, Resolution } from '../../../afk-runner/src/agent-layer.js'
import {
  concernDigest,
  concernRecords,
  detectConcernThrash,
  fingerprintOf,
  LEDGER_DIGEST_MAX,
} from '../../../afk-runner/src/work/concern-model.js'
import type { LedgerEntry } from '../../../afk-runner/src/work/concern-model.js'

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return { id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed', ...overrides }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return { id: 'F1', class: 'MATERIAL', gap: 'g', question: 'q', code_evidence_attempted: 'e', ...overrides }
}

function ledgerEntry(round: number, overrides: Partial<Resolution> & { gap?: string } = {}): LedgerEntry {
  return {
    round,
    gap: overrides.gap ?? 'the proposal never names the scope id',
    resolution: resolution({
      id: overrides.id ?? 'F2',
      class: overrides.class ?? 'MATERIAL',
      resolution: overrides.resolution ?? 'edited',
      outcome: overrides.justification === undefined ? (overrides.outcome ?? 'narrowed gap') : overrides.outcome,
      ...(overrides.justification === undefined ? {} : { justification: overrides.justification }),
    }),
  }
}

describe('fingerprintOf normalization (D1)', () => {
  it('is insensitive to case, punctuation, and whitespace', () => {
    const a = fingerprintOf('THEN** the round SHALL discover what failed from the check runs')
    const b = fingerprintOf('then the round shall discover what failed from the check runs.')
    expect(a).toBe(b)
  })

  it('prunes stopwords so stopword-only differences are the same concern', () => {
    expect(fingerprintOf('the migration of the table')).toBe(fingerprintOf('migration table'))
  })

  it('keeps distinct concerns distinct', () => {
    expect(fingerprintOf('Hook/TDD interactions gate the TS edits')).not.toBe(
      fingerprintOf('Failed check runs map into the existing FailedJob shape'),
    )
  })

  it('folds an empty gap to the empty token set; grouping keys it round:id instead', () => {
    expect(fingerprintOf('')).toBe('')
    expect(fingerprintOf('   ')).toBe('')
  })
})

describe('concernDigest (loop-memory D4)', () => {
  it('groups per concern across rounds with round tags, most recent first', () => {
    const lines = concernDigest([
      ledgerEntry(1, { id: 'F2' }),
      ledgerEntry(3, {
        id: 'F9',
        gap: 'a different concern about naming the flag',
        class: 'NITPICK',
        resolution: 'dismissed',
        justification: 'cosmetic',
      }),
      ledgerEntry(3, { id: 'S1' }),
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('r3 [S1] MATERIAL edited — narrowed gap (seen r1..r3)')
    expect(lines[1]).toBe('r3 [F9] NITPICK dismissed — cosmetic (seen r3..r3)')
  })

  it('caps the digest at the compiled concern budget with an overflow note', () => {
    const many: LedgerEntry[] = []
    for (let index = 0; index < LEDGER_DIGEST_MAX + 2; index += 1) {
      many.push(ledgerEntry(1, { id: `F${index}`, gap: `unique concern number ${index} about thing ${index}` }))
    }
    const lines = concernDigest(many)
    expect(lines).toHaveLength(LEDGER_DIGEST_MAX + 1)
    expect(lines.at(-1)).toBe(`… and 2 older concerns (see sidecars/resolutions-*.json)`)
  })

  it('concernRecords groups the ledger per fingerprint with round bounds and outcome-bearing entries', () => {
    const records = concernRecords([
      ledgerEntry(1, { id: 'F2' }),
      ledgerEntry(3, { id: 'S1' }),
      ledgerEntry(3, {
        id: 'F9',
        gap: 'a different concern about naming the flag',
        class: 'NITPICK',
        resolution: 'dismissed',
        justification: 'cosmetic',
      }),
    ])
    const scoped = records.find(
      (record) => record.fingerprint === fingerprintOf('the proposal never names the scope id'),
    )
    expect(scoped?.firstRound).toBe(1)
    expect(scoped?.lastRound).toBe(3)
    expect(scoped?.entries).toEqual([
      { round: 1, id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' },
      { round: 3, id: 'S1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' },
    ])
    const naming = records.find(
      (record) => record.fingerprint === fingerprintOf('a different concern about naming the flag'),
    )
    expect(naming?.entries[0]?.outcome).toBe('cosmetic')
  })

  it('groups empty-gap entries alone under the round:id fallback key', () => {
    const records = concernRecords([
      ledgerEntry(1, { id: 'F2', gap: '' }),
      ledgerEntry(2, { id: 'F3', gap: '' }),
      ledgerEntry(2, { id: 'F4' }),
    ])
    expect(records.map((record) => record.fingerprint)).toEqual([
      '@1:F2',
      '@2:F3',
      fingerprintOf('the proposal never names the scope id'),
    ])
  })

  it('detectConcernThrash fires on a third-strike re-raise or a class oscillation', () => {
    const records = concernRecords([
      ledgerEntry(1, { id: 'F2' }),
      ledgerEntry(2, { id: 'F5' }),
      ledgerEntry(2, {
        id: 'F9',
        gap: 'unrelated one-off concern',
        class: 'NITPICK',
        resolution: 'dismissed',
        justification: 'cosmetic',
      }),
    ])
    const thrashGap = finding({ id: 'S1', gap: 'The proposal never names the scope ID.' })
    expect(detectConcernThrash(records, [thrashGap], 3)).toHaveLength(1)
    expect(detectConcernThrash(records, [thrashGap], 3)[0]?.firstRound).toBe(1)
    const fresh = finding({ id: 'S2', gap: 'a brand new concern about queue backpressure' })
    expect(detectConcernThrash(records, [fresh], 3)).toHaveLength(0)
    const oscillating = concernRecords([ledgerEntry(1, { id: 'F2', class: 'MATERIAL' })])
    const raisedHarder = finding({ id: 'S1', class: 'BLOCKER', gap: 'The proposal never names the scope ID.' })
    expect(detectConcernThrash(oscillating, [raisedHarder], 3)).toHaveLength(1)
    const raisedSame = finding({ id: 'S1', class: 'MATERIAL', gap: 'The proposal never names the scope ID.' })
    expect(detectConcernThrash(oscillating, [raisedSame], 3)).toHaveLength(0)
  })
})
