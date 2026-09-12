// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsPreferences } from '../../db/schema.js'
import type { AnalyticsPreferenceRow } from '../../db/schema.js'
import type { PreferenceSource } from './preference-types.js'

type Tx = Parameters<ReturnType<typeof defaultGetDrizzleDb>['transaction']>[0] extends (tx: infer T) => unknown
  ? T
  : never

type PreferenceUpsertInput = Readonly<{
  governanceActorKey: string
  keyVersion: string
  policyVersion: number
  source: PreferenceSource
  nowMs: number
  apply: (
    current: AnalyticsPreferenceRow | undefined,
  ) => Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>
}>

const insertPreferenceRow = (
  tx: Tx,
  input: PreferenceUpsertInput,
  lanes: Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>,
): void => {
  tx.insert(analyticsPreferences)
    .values({
      governanceActorKey: input.governanceActorKey,
      keyVersion: input.keyVersion,
      localLongitudinal: lanes.localLongitudinal,
      externalPseudonymous: lanes.externalPseudonymous,
      policyVersion: input.policyVersion,
      source: input.source,
      effectiveAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .run()
}

const updatePreferenceRow = (
  tx: Tx,
  input: PreferenceUpsertInput,
  lanes: Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>,
): void => {
  tx.update(analyticsPreferences)
    .set({
      keyVersion: input.keyVersion,
      localLongitudinal: lanes.localLongitudinal,
      externalPseudonymous: lanes.externalPseudonymous,
      policyVersion: input.policyVersion,
      source: input.source,
      effectiveAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .where(eq(analyticsPreferences.governanceActorKey, input.governanceActorKey))
    .run()
}

export const upsertPreferenceRowInTx = (tx: Tx, input: PreferenceUpsertInput): AnalyticsPreferenceRow => {
  const current = tx
    .select()
    .from(analyticsPreferences)
    .where(eq(analyticsPreferences.governanceActorKey, input.governanceActorKey))
    .get()
  const lanes = input.apply(current)
  if (current === undefined) {
    insertPreferenceRow(tx, input, lanes)
  } else {
    updatePreferenceRow(tx, input, lanes)
  }
  const row = tx
    .select()
    .from(analyticsPreferences)
    .where(eq(analyticsPreferences.governanceActorKey, input.governanceActorKey))
    .get()
  if (row === undefined) throw new Error('preference upsert failed to persist')
  return row
}

export type { Tx as PreferenceTx }
export type { PreferenceUpsertInput }
