// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { copyChildrenMaterializationsBackfillIn } from './copy-children.js'
import { copyChildrenPreferencesCollectionGrantsIn } from './copy-governance.js'
import { copyChildrenDeliveryDeletionIn, copyParentsIn } from './copy.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import { remoteDeleteIn } from './remote.js'
import type { RekeySubphase, RekeyTx } from './run-store.js'
import {
  runCutoverFenceDrainDelta,
  runCutoverSnapshotQuiesced,
  runRemoteResend,
  runRetireWaitingHorizon,
  runSnapshotRepublishSwitch,
  runSwapActiveGeneration,
} from './subphase-boundary.js'
import {
  GOVERNANCE_DOMAINS,
  IDENTITY_DOMAINS,
  installMappings,
  requireVerifiedIn,
  runCheckpointedSubphase,
} from './subphase-shared.js'
import type { RekeyApplyResult, RekeySubphaseContext, SubphaseCounts } from './subphase-shared.js'

export type { RekeyApplyResult, RekeySubphaseContext } from './subphase-shared.js'

const SIMPLE_SUBPHASES: Readonly<
  Record<
    string,
    (
      tx: RekeyTx,
      run: AnalyticsRekeyRunRow,
      material: RekeyFullKeyMaterial,
      ctx: RekeySubphaseContext,
    ) => SubphaseCounts
  >
> = {
  'dual_write.identity': (tx, run, material, ctx) => ({
    mappedCount:
      run.mappedCount + installMappings(tx, run, material, IDENTITY_DOMAINS, material.analyticsToKey, ctx.nowMs()),
  }),
  'dual_write.governance': (tx, run, material, ctx) => ({
    mappedCount:
      run.mappedCount + installMappings(tx, run, material, GOVERNANCE_DOMAINS, material.governanceToKey, ctx.nowMs()),
  }),
  'copy_parents.events_sources': (tx, run, material) => ({
    copiedCount: run.copiedCount + copyParentsIn(tx, run, material),
  }),
  'copy_children.materializations_backfill': (tx, run, material) => {
    copyChildrenMaterializationsBackfillIn(tx, run, material)
    return {}
  },
  'copy_children.preferences_collection_grants': (tx, run, material) => {
    copyChildrenPreferencesCollectionGrantsIn(tx, run, material)
    return {}
  },
  'copy_children.delivery_deletion': (tx, run, material) => {
    copyChildrenDeliveryDeletionIn(tx, run, material)
    return {}
  },
  'verify.local_graph': (tx, run, material) => {
    requireVerifiedIn(tx, run, material)
    return { verifiedCount: run.verifiedCount + 1 }
  },
  remote_delete: (tx, run, _material, ctx) => {
    remoteDeleteIn(tx, run, ctx.egress, ctx.nowMs())
    return {}
  },
}

/**
 * Executes one bounded subphase and persists its checkpoint in the same
 * transaction (the cutover/snapshot/remote phases checkpoint around external
 * coordinator or egress calls, never skipping the persisted boundary).
 * Returns a terminal result only for the retire subphase.
 */
export const runRekeySubphase = (
  subphase: RekeySubphase,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  ctx: RekeySubphaseContext,
): RekeyApplyResult | null => {
  const simple = SIMPLE_SUBPHASES[subphase]
  if (simple !== undefined) {
    runCheckpointedSubphase(subphase, run, ctx, (tx) => simple(tx, run, material, ctx))
    return null
  }
  if (subphase === 'cutover.fence_drain_delta') runCutoverFenceDrainDelta(run, material, ctx)
  if (subphase === 'cutover.snapshot_quiesced') runCutoverSnapshotQuiesced(run, material, ctx)
  if (subphase === 'swap.active_generation') runSwapActiveGeneration(run, material, ctx)
  if (subphase === 'snapshot_republish.quiesce_build_switch') runSnapshotRepublishSwitch(run, ctx)
  if (subphase === 'remote_resend') runRemoteResend(run, ctx)
  if (subphase === 'retire.waiting_horizon') return runRetireWaitingHorizon(run, material, ctx)
  return null
}
