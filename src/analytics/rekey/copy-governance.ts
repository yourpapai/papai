// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { analyticsCollectionEligibility, analyticsEligibilityGrants, analyticsPreferences } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { governanceRemap } from './copy.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import type { RekeyTx } from './run-store.js'

type GovernanceMirrorSpec<Row extends { keyVersion: string }> = Readonly<{
  rows: readonly Row[]
  keyOf: (row: Row) => string
  domain: string
  exists: (newKey: string) => boolean
  insert: (row: Row, newKey: string) => void
}>

const mirrorGovernanceRowsIn = <Row extends { keyVersion: string }>(
  material: RekeyFullKeyMaterial,
  spec: GovernanceMirrorSpec<Row>,
): void => {
  for (const row of spec.rows) {
    if (row.keyVersion === material.toVersion) continue
    const newKey = governanceRemap(material, spec.domain, spec.keyOf(row))
    if (newKey === spec.keyOf(row)) continue
    if (spec.exists(newKey)) continue
    spec.insert(row, newKey)
  }
}

/** copy_children.preferences_collection_grants: governance rows mirrored under target key versions. */
export const copyChildrenPreferencesCollectionGrantsIn = (
  tx: RekeyTx,
  _run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
): void => {
  mirrorGovernanceRowsIn(material, {
    rows: tx.select().from(analyticsPreferences).all(),
    keyOf: (row) => row.governanceActorKey,
    domain: 'governance-actor:v1',
    exists: (newKey) =>
      tx.select().from(analyticsPreferences).where(eq(analyticsPreferences.governanceActorKey, newKey)).get() !==
      undefined,
    insert: (row, newKey) => {
      tx.insert(analyticsPreferences)
        .values({ ...row, governanceActorKey: newKey, keyVersion: material.toVersion })
        .run()
    },
  })
  mirrorGovernanceRowsIn(material, {
    rows: tx.select().from(analyticsCollectionEligibility).all(),
    keyOf: (row) => row.refKey,
    domain: 'collection-eligibility:v1',
    exists: (newKey) =>
      tx
        .select()
        .from(analyticsCollectionEligibility)
        .where(eq(analyticsCollectionEligibility.refKey, newKey))
        .get() !== undefined,
    insert: (row, newKey) => {
      tx.insert(analyticsCollectionEligibility)
        .values({ ...row, refKey: newKey, keyVersion: material.toVersion })
        .run()
    },
  })
  mirrorGovernanceRowsIn(material, {
    rows: tx.select().from(analyticsEligibilityGrants).all(),
    keyOf: (row) => row.grantKey,
    domain: 'delivery-grant:v1',
    exists: (newKey) =>
      tx.select().from(analyticsEligibilityGrants).where(eq(analyticsEligibilityGrants.grantKey, newKey)).get() !==
      undefined,
    insert: (row, newKey) => {
      tx.insert(analyticsEligibilityGrants)
        .values({ ...row, grantKey: newKey, keyVersion: material.toVersion })
        .run()
    },
  })
}
