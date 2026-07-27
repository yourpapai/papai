// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Fixture for the shadow-funnel CLI dry-run. Seeds rows through the real
 * `insertShadowLogRow` writer -- not raw SQL -- so a column the writer sets wrongly
 * surfaces in the dry-run rather than in production.
 *
 * Expected aggregates are hardcoded in the test, not recomputed from this builder:
 * deriving them here would re-run the arithmetic under test and assert it equals itself.
 */

import type { ShadowLogRow } from '../../src/long-term-memory/shadow-log-row.js'
import { insertShadowLogRow } from '../../src/long-term-memory/store.js'

type TurnCategory = 'under-trigger' | 'pulled-overlap' | 'over-pull' | 'quiet'

type ModelFixture = Readonly<{
  readerModelId: string
  /** Scope hashes are `${scopePrefix}${index padded to 2}`. */
  scopePrefix: string
  scopeCount: number
  turnsPerScope: number
  underTrigger: number
  pulledOverlap: number
  overPull: number
}>

const MODEL_FIXTURES: readonly ModelFixture[] = [
  {
    readerModelId: 'model-a',
    scopePrefix: 'scope-a-',
    scopeCount: 55,
    turnsPerScope: 2,
    underTrigger: 4,
    pulledOverlap: 30,
    overPull: 10,
  },
  {
    readerModelId: 'model-b',
    scopePrefix: 'scope-b-',
    scopeCount: 52,
    turnsPerScope: 2,
    underTrigger: 13,
    pulledOverlap: 20,
    overPull: 5,
  },
  // Reuses model-a's scope prefix on purpose: a globally-distinct scope count would
  // print 107 rather than the correct per-model 55 / 52 / 12.
  {
    readerModelId: 'model-c',
    scopePrefix: 'scope-a-',
    scopeCount: 12,
    turnsPerScope: 2,
    underTrigger: 6,
    pulledOverlap: 4,
    overPull: 2,
  },
]

/** Scopes that only ever produced zero-active-record turns. Must not inflate M. */
const ZERO_RECORD_SCOPE_COUNT = 5
const ZERO_RECORD_TURNS_PER_SCOPE = 2

function scopeHashFor(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(2, '0')}`
}

function categoriesFor(fixture: ModelFixture): readonly TurnCategory[] {
  const total = fixture.scopeCount * fixture.turnsPerScope
  const quiet = total - fixture.underTrigger - fixture.pulledOverlap - fixture.overPull
  return [
    ...Array.from({ length: fixture.underTrigger }, (): TurnCategory => 'under-trigger'),
    ...Array.from({ length: fixture.pulledOverlap }, (): TurnCategory => 'pulled-overlap'),
    ...Array.from({ length: fixture.overPull }, (): TurnCategory => 'over-pull'),
    ...Array.from({ length: quiet }, (): TurnCategory => 'quiet'),
  ]
}

type CategoryFields = Pick<
  ShadowLogRow,
  | 'activeRecordCount'
  | 'shadowHitCount'
  | 'modelPulled'
  | 'pullCount'
  | 'pullQueryHash'
  | 'pullResultCount'
  | 'shadowPullOverlap'
>

function rowForCategory(category: TurnCategory): CategoryFields {
  switch (category) {
    case 'under-trigger':
      // The P1 headline bucket: the shadow surfaced something, the model never looked.
      return {
        activeRecordCount: 3,
        shadowHitCount: 1,
        modelPulled: false,
        pullCount: 0,
        pullQueryHash: null,
        pullResultCount: 0,
        shadowPullOverlap: 0,
      }
    case 'pulled-overlap':
      return {
        activeRecordCount: 3,
        shadowHitCount: 2,
        modelPulled: true,
        pullCount: 1,
        pullQueryHash: 'hash-pull',
        pullResultCount: 2,
        shadowPullOverlap: 1,
      }
    case 'over-pull':
      return {
        activeRecordCount: 3,
        shadowHitCount: 1,
        modelPulled: true,
        pullCount: 1,
        pullQueryHash: 'hash-pull',
        pullResultCount: 1,
        shadowPullOverlap: 0,
      }
    case 'quiet':
      // Memory-bearing, but the shadow surfaced nothing: counts toward N and M only.
      return {
        activeRecordCount: 2,
        shadowHitCount: 0,
        modelPulled: false,
        pullCount: 0,
        pullQueryHash: null,
        pullResultCount: 0,
        shadowPullOverlap: 0,
      }
    default: {
      const exhaustive: never = category
      throw new Error(`unhandled turn category: ${String(exhaustive)}`)
    }
  }
}

function baseRow(readerModelId: string, scopeHash: string, turnRef: string): ShadowLogRow {
  return {
    scopeHash,
    contextHash: `hash-context-${scopeHash}`,
    turnRef,
    readerModelId,
    activeRecordCount: 0,
    shadowQueryHash: 'hash-query',
    shadowQueryLenBucket: 'medium',
    shadowHitCount: 0,
    shadowTopScore: null,
    shadowTopProvenance: null,
    shadowTopRecordHash: null,
    modelPulled: false,
    pullCount: 0,
    pullQueryHash: null,
    pullResultCount: 0,
    shadowPullOverlap: 0,
    skippedReason: null,
  }
}

/** Top-hit fields are set only when the shadow actually hit, mirroring the real writer. */
function topHitFields(
  fields: CategoryFields,
): Pick<ShadowLogRow, 'shadowTopScore' | 'shadowTopProvenance' | 'shadowTopRecordHash'> {
  if (fields.shadowHitCount === 0) {
    return { shadowTopScore: null, shadowTopProvenance: null, shadowTopRecordHash: null }
  }
  return { shadowTopScore: 0.5, shadowTopProvenance: 'current', shadowTopRecordHash: 'hash-record' }
}

function seedModel(fixture: ModelFixture): void {
  const categories = categoriesFor(fixture)
  categories.forEach((category, turnIndex) => {
    const scopeHash = scopeHashFor(fixture.scopePrefix, Math.floor(turnIndex / fixture.turnsPerScope))
    const turnRef = `${fixture.readerModelId}-turn-${turnIndex}`
    const fields = rowForCategory(category)
    insertShadowLogRow({
      ...baseRow(fixture.readerModelId, scopeHash, turnRef),
      ...fields,
      ...topHitFields(fields),
    })
  })
}

function seedZeroRecordScopes(readerModelId: string): void {
  for (let scopeIndex = 0; scopeIndex < ZERO_RECORD_SCOPE_COUNT; scopeIndex++) {
    for (let turnIndex = 0; turnIndex < ZERO_RECORD_TURNS_PER_SCOPE; turnIndex++) {
      const scopeHash = `${readerModelId}-zero-${scopeIndex}`
      insertShadowLogRow({
        ...baseRow(readerModelId, scopeHash, `${scopeHash}-turn-${turnIndex}`),
        skippedReason: 'no-active-records',
      })
    }
  }
}

/** Seeds the full fixture into whatever database the Drizzle singleton points at. */
export function seedShadowFunnelFixture(): void {
  for (const fixture of MODEL_FIXTURES) {
    seedModel(fixture)
  }
  seedZeroRecordScopes('model-a')
}
