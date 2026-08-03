// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEvents } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { cancelNeverStartedIn } from '../delivery/settlement.js'
import { expandKeysThroughMappings } from '../rekey/mapping-store.js'
import { revokeEligibilityInTx } from './collection-store.js'
import {
  createDeletionRequestIn,
  listUnresolvedDeletionRequests,
  sealDeletionTargetsIn,
} from './deletion-target-store.js'
import type { DeletionTargetSet } from './deletion-target-store.js'
import { revokeGrantInTx } from './grant-store.js'
import { appendPolicyAuditInTx, upsertPreferenceDenyInTx } from './preference-lifecycle.js'
import type { SnapshotInvalidator } from './snapshot-invalidator.js'
import { executeDeletionWorkflow } from './subject-deletion.js'
import type { DeletionWorkflowResult, RemoteDeletionRequest, SubjectDeletionDeps } from './subject-deletion.js'
import { buildSubjectExport } from './subject-export.js'
import type { SubjectExport } from './subject-export.js'
import { deriveSubjectKeys, flattenSubjectKeys } from './subject-keys.js'
import { ANALYTICS_ACTOR_DOMAIN } from './subject-keys.js'
import type { SubjectIdentity, SubjectKeyrings } from './subject-keys.js'

const log = logger.child({ scope: 'analytics:governance:subject-service' })

const DEFAULT_POLICY_VERSION = 1

export type SubjectServiceDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  keyrings: SubjectKeyrings
  snapshotInvalidator: SnapshotInvalidator
  requestRemoteDeletion?: RemoteDeletionRequest
  onSubjectWithdraw?: (identity: SubjectIdentity) => void
  policyVersion?: number
}>

const toDeletionDeps = (deps: SubjectServiceDeps): SubjectDeletionDeps => ({
  getDrizzleDb: deps.getDrizzleDb,
  keyrings: deps.keyrings,
  snapshotInvalidator: deps.snapshotInvalidator,
  requestRemoteDeletion: deps.requestRemoteDeletion,
})

/**
 * All-retained-version subject keys plus forward translation through retained
 * encrypted rekey mappings, so denial, export, and deletion search active,
 * target-shadow, and retired generations and rekeyed rows alike.
 */
const expandedSubjectKeys = (
  keys: ReturnType<typeof deriveSubjectKeys>,
  deps: SubjectServiceDeps,
): ReturnType<typeof flattenSubjectKeys> => {
  const flat = flattenSubjectKeys(keys)
  const encryptionKeys =
    deps.keyrings.governance.kind === 'available' ? [...deps.keyrings.governance.keys.values()] : []
  if (encryptionKeys.length === 0) return flat
  const expanded = expandKeysThroughMappings(
    {
      [ANALYTICS_ACTOR_DOMAIN]: flat.analyticsActorKeys,
      'governance-actor:v1': flat.governanceActorKeys,
      'collection-eligibility:v1': flat.collectionRefKeys,
      'delivery-grant:v1': flat.grantKeys,
    },
    encryptionKeys,
    { getDrizzleDb: deps.getDrizzleDb },
  )
  return {
    analyticsActorKeys: expanded.get(ANALYTICS_ACTOR_DOMAIN) ?? flat.analyticsActorKeys,
    governanceActorKeys: expanded.get('governance-actor:v1') ?? flat.governanceActorKeys,
    collectionRefKeys: expanded.get('collection-eligibility:v1') ?? flat.collectionRefKeys,
    grantKeys: expanded.get('delivery-grant:v1') ?? flat.grantKeys,
  }
}

export const exportSubjectData = (
  identity: SubjectIdentity,
  deps: SubjectServiceDeps,
  nowMs: number,
): SubjectExport => {
  const keys = expandedSubjectKeys(deriveSubjectKeys(identity, deps.keyrings), deps)
  log.info('authenticated subject export served')
  return buildSubjectExport(keys, deps, nowMs)
}

type Tx = Parameters<ReturnType<typeof defaultGetDrizzleDb>['transaction']>[0] extends (tx: infer T) => unknown
  ? T
  : never

const cancelNeverStartedForActorsIn = (tx: Tx, analyticsActorKeys: readonly string[]): void => {
  if (analyticsActorKeys.length === 0) return
  const subjectEventIds = tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(inArray(analyticsEvents.actorKey, [...analyticsActorKeys]))
    .all()
    .map((row) => row.eventId)
  cancelNeverStartedIn(tx, subjectEventIds)
}

const resolvePrimaryGovernance = (
  keys: ReturnType<typeof deriveSubjectKeys>,
  activeVersion: string,
): Readonly<{ governanceActorKey: string; keyVersion: string }> => {
  const primary = keys.governanceActorKeys.find((entry) => entry.keyVersion === activeVersion)
  const governanceActorKey = primary?.pseudonym ?? keys.governanceActorKeys[0]?.pseudonym
  if (governanceActorKey === undefined) throw new Error('no retained governance key version for the subject')
  return { governanceActorKey, keyVersion: primary?.keyVersion ?? keys.governanceActorKeys[0]?.keyVersion ?? 'v1' }
}

/**
 * The withdrawal transaction: deny UPSERTs, ref/grant generation advance and
 * revocation, never-started delivery cancel, and the durable deletion request
 * with its sealed target bundle plus audit — all in one transaction, before
 * any settlement runs.
 */
export const requestSubjectDeletion = (
  identity: SubjectIdentity,
  deps: SubjectServiceDeps,
  nowMs: number,
): Readonly<{ requestId: string; governanceActorKey: string; keyVersion: string }> => {
  const keys = deriveSubjectKeys(identity, deps.keyrings)
  const flat = expandedSubjectKeys(keys, deps)
  const targets: DeletionTargetSet = {
    analyticsActorKeys: flat.analyticsActorKeys,
    governanceActorKeys: flat.governanceActorKeys,
    collectionRefKeys: flat.collectionRefKeys,
    grantKeys: flat.grantKeys,
  }
  const governance = deps.keyrings.governance
  if (governance.kind !== 'available') {
    throw new Error('governance keyring unavailable; deletion targets cannot be sealed')
  }
  const { governanceActorKey, keyVersion } = resolvePrimaryGovernance(keys, governance.activeVersion)
  const requestId = randomUUID()
  const policyVersion = deps.policyVersion ?? DEFAULT_POLICY_VERSION
  const db = deps.getDrizzleDb()
  db.transaction((tx) => {
    for (const governanceKey of flat.governanceActorKeys) {
      upsertPreferenceDenyInTx(tx, {
        governanceActorKey: governanceKey,
        keyVersion,
        policyVersion,
        source: 'authenticated_request',
        nowMs,
      })
    }
    appendPolicyAuditInTx(tx, { governanceActorKey, action: 'withdraw', policyVersion, nowMs })
    for (const refKey of [...flat.collectionRefKeys].sort()) {
      revokeEligibilityInTx(tx, { refKey, policyVersion, nowMs })
    }
    for (const grantKey of [...flat.grantKeys].sort()) {
      revokeGrantInTx(tx, { grantKey, policyVersion, nowMs })
    }
    cancelNeverStartedForActorsIn(tx, flat.analyticsActorKeys)
    createDeletionRequestIn(tx, { requestId, governanceActorKey, keyVersion, policyVersion, nowMs })
    sealDeletionTargetsIn(tx, {
      requestId,
      targets,
      encryptionKey: governance.activeKey,
      nowMs,
    })
    appendPolicyAuditInTx(tx, { governanceActorKey, action: 'delete_requested', policyVersion, nowMs })
  })
  return { requestId, governanceActorKey, keyVersion }
}

export const deleteSubjectData = (
  identity: SubjectIdentity,
  deps: SubjectServiceDeps,
  nowMs: number,
): DeletionWorkflowResult => {
  const { requestId, governanceActorKey } = requestSubjectDeletion(identity, deps, nowMs)
  const result = executeDeletionWorkflow({ requestId, nowMs }, toDeletionDeps(deps))
  const policyVersion = deps.policyVersion ?? DEFAULT_POLICY_VERSION
  deps.getDrizzleDb().transaction((tx) => {
    appendPolicyAuditInTx(tx, { governanceActorKey, action: 'delete_completed', policyVersion, nowMs })
  })
  log.info('authenticated subject deletion completed')
  return result
}

export const withdrawSubject = (
  identity: SubjectIdentity,
  deps: SubjectServiceDeps,
  nowMs: number,
): DeletionWorkflowResult => {
  const result = deleteSubjectData(identity, deps, nowMs)
  deps.onSubjectWithdraw?.(identity)
  return result
}

export const resumeUnresolvedDeletions = (deps: SubjectServiceDeps, nowMs: number): readonly string[] => {
  const outcomes: string[] = []
  for (const request of listUnresolvedDeletionRequests(deps)) {
    if (request.state === 'failed' || request.state === 'requested' || request.state === 'in_progress') {
      const result = executeDeletionWorkflow({ requestId: request.requestId, nowMs }, toDeletionDeps(deps))
      outcomes.push(result.state)
    }
  }
  if (outcomes.length > 0) log.info({ count: outcomes.length }, 'unresolved deletion requests resumed')
  return outcomes
}
