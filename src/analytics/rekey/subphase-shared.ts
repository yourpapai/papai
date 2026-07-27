// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import type { GenerationTransitionCoordinator } from '../governance/snapshot-invalidator.js'
import { copyChildrenMaterializationsBackfillIn } from './copy-children.js'
import { copyChildrenPreferencesCollectionGrantsIn } from './copy-governance.js'
import { copyChildrenDeliveryDeletionIn, copyParentsIn } from './copy.js'
import type { RekeyCutoverFence } from './cutover-fence.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import { installDomainMappingsIn } from './mapping-inventory.js'
import type { RekeyRemoteEgress } from './remote.js'
import { checkpointRekeyRunIn, SUBPHASE_PHASE } from './run-store.js'
import type { RekeySubphase, RekeyTx } from './run-store.js'
import { verifyMappingNormalizedContentIn } from './verify-content.js'
import { verifyShadowEquationIn } from './verify.js'

export type RekeySubphaseContext = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  coordinator: GenerationTransitionCoordinator
  egress: RekeyRemoteEgress
  fence: RekeyCutoverFence
  retainedEventHorizonDays: number
  nowMs: () => number
  snapshotConsumerOpen?: () => boolean
}>

export type RekeyApplyResult = Readonly<{
  status: string
  phase: string
  subphase: string | null
  retired: boolean
  refusedReasons: readonly string[]
}>

export type SubphaseCounts = Partial<{ mappedCount: number; copiedCount: number; verifiedCount: number }>

export const IDENTITY_DOMAINS = [
  'deployment:v1',
  'platform-instance:v1',
  'actor:v1',
  'context:v1',
  'conversation:v1',
  'thread:v1',
  'turn:v1',
  'llm-attempt:v1',
  'task-instance:v1',
  'model:v1',
  'tool:v1',
  'coding-project:v1',
  'coding-session:v1',
  'session:v1',
  'materialization:v1',
] as const

export const GOVERNANCE_DOMAINS = ['governance-actor:v1', 'collection-eligibility:v1', 'delivery-grant:v1'] as const

export const requireVerifiedIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow, material: RekeyFullKeyMaterial): void => {
  const equation = verifyShadowEquationIn(tx, run, material.encryptionKeys)
  const content = verifyMappingNormalizedContentIn(tx, run, material)
  if (!equation.ok || !content.ok) throw new Error('rekey fenced verification failed')
}

const copyDeltaIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow, material: RekeyFullKeyMaterial): number => {
  const copied = copyParentsIn(tx, run, material)
  copyChildrenMaterializationsBackfillIn(tx, run, material)
  copyChildrenPreferencesCollectionGrantsIn(tx, run, material)
  copyChildrenDeliveryDeletionIn(tx, run, material)
  return copied
}

export const installMappings = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  domains: readonly string[],
  toKey: Buffer,
  nowMs: number,
): number =>
  installDomainMappingsIn(tx, {
    runId: run.runId,
    sourceGeneration: run.sourceGeneration,
    domains,
    toKey,
    toVersion: material.toVersion,
    encryptionKey: material.encryptionKey,
    nowMs,
  }).installed

/** Delta catch-up: domain-complete mappings for post-high-water keys plus the FK-ordered copy. */
export const copyDeltaWithMappingsIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  nowMs: number,
): number => {
  installMappings(tx, run, material, IDENTITY_DOMAINS, material.analyticsToKey, nowMs)
  installMappings(tx, run, material, GOVERNANCE_DOMAINS, material.governanceToKey, nowMs)
  return copyDeltaIn(tx, run, material)
}

/** Executes one bounded unit of work and persists its checkpoint in the same transaction. */
export const runCheckpointedSubphase = (
  subphase: RekeySubphase,
  run: AnalyticsRekeyRunRow,
  ctx: RekeySubphaseContext,
  work: (tx: RekeyTx) => SubphaseCounts,
): void => {
  ctx.getDrizzleDb().transaction((tx) => {
    const counts = work(tx)
    checkpointRekeyRunIn(tx, {
      runId: run.runId,
      phase: SUBPHASE_PHASE[subphase],
      subphase,
      status: 'running',
      ...counts,
      nowMs: ctx.nowMs(),
    })
  })
}
