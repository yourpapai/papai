// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { AnalyticsSinkRow } from '../../db/schema.js'
import { analyticsSinks } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { SecretPayload } from '../../secret-payload-crypto.js'
import { decryptSecretPayload, encryptSecretPayload } from '../../secret-payload-crypto.js'
import type { SinkCapabilities, SinkGateDenial, SinkProcessorReview } from './sink.js'
import { assessSink, DELIVERY_PAYLOAD_SCHEMA_VERSION } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:sink-service' })

export type SinkProbe = (
  input: Readonly<{ endpoint: string; secret: string; kind: string; egressMode: string }>,
) => Promise<Readonly<{ ok: boolean; failureClass?: string }>>

export type SinkServiceDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  probe: SinkProbe
  encrypt?: (plain: SecretPayload) => string
  decrypt?: (encoded: string) => SecretPayload
}>

export type SinkPublicView = Readonly<{
  sinkVersionId: string
  logicalSinkId: string
  version: number
  kind: string
  egressMode: string
  state: string
  payloadSchemaVersion: number
  configFingerprint: string
  verifiedAtMs: number | null
  createdAtMs: number
  disabledAtMs: number | null
}>

const toPublicView = (row: AnalyticsSinkRow): SinkPublicView => ({
  sinkVersionId: row.sinkVersionId,
  logicalSinkId: row.logicalSinkId,
  version: row.version,
  kind: row.kind,
  egressMode: row.egressMode,
  state: row.state,
  payloadSchemaVersion: row.payloadSchemaVersion,
  configFingerprint: row.configFingerprint,
  verifiedAtMs: row.verifiedAtMs,
  createdAtMs: row.createdAtMs,
  disabledAtMs: row.disabledAtMs,
})

const sinkVersionIdFor = (logicalSinkId: string, version: number): string => `${logicalSinkId}:v${version}`

const fingerprintConfig = (input: Readonly<{ kind: string; egressMode: string; endpoint: string }>): string =>
  createHash('sha256').update(`${input.kind}|${input.egressMode}|${input.endpoint}`).digest('hex')

const requireHttpsEndpoint = (endpoint: string): void => {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('sink endpoint is not a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('sink endpoint must use HTTPS')
}

export type CreateSinkVersionInput = Readonly<{
  logicalSinkId: string
  kind: 'webhook' | 'openpanel'
  egressMode: 'aggregate' | 'pseudonymous'
  endpoint: string
  secret: string
  nowMs: number
}>

export const createSinkVersion = (input: CreateSinkVersionInput, deps: SinkServiceDeps): SinkPublicView => {
  requireHttpsEndpoint(input.endpoint)
  const encrypt = deps.encrypt ?? encryptSecretPayload
  const db = deps.getDrizzleDb()
  const view = db.transaction((tx) => {
    const latest = tx
      .select({ version: analyticsSinks.version })
      .from(analyticsSinks)
      .where(eq(analyticsSinks.logicalSinkId, input.logicalSinkId))
      .orderBy(desc(analyticsSinks.version))
      .limit(1)
      .get()
    const version = (latest?.version ?? 0) + 1
    const row: typeof analyticsSinks.$inferInsert = {
      sinkVersionId: sinkVersionIdFor(input.logicalSinkId, version),
      logicalSinkId: input.logicalSinkId,
      version,
      kind: input.kind,
      state: 'pending_verification',
      payloadSchemaVersion: DELIVERY_PAYLOAD_SCHEMA_VERSION,
      egressMode: input.egressMode,
      endpointCiphertext: encrypt({ endpoint: input.endpoint }),
      secretCiphertext: encrypt({ secret: input.secret }),
      configFingerprint: fingerprintConfig(input),
      createdAtMs: input.nowMs,
    }
    tx.insert(analyticsSinks).values(row).run()
    const inserted = tx.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, row.sinkVersionId)).get()
    if (inserted === undefined) throw new Error('sink version missing after create')
    return toPublicView(inserted)
  })
  log.info({ logicalSinkId: input.logicalSinkId, version: view.version }, 'sink version created')
  return view
}

type VerifyGateInput = Readonly<{
  capabilities: SinkCapabilities
  processorReview: SinkProcessorReview
  httpsPolicyApproved: boolean
}>

const decryptRow = (row: AnalyticsSinkRow, deps: SinkServiceDeps): { endpoint: string; secret: string } => {
  const decrypt = deps.decrypt ?? decryptSecretPayload
  const endpoint = decrypt(row.endpointCiphertext)['endpoint']
  const secret = decrypt(row.secretCiphertext)['secret']
  if (endpoint === undefined || secret === undefined) throw new Error('sink ciphertext payload is malformed')
  return { endpoint, secret }
}

const runGate = (
  row: AnalyticsSinkRow,
  gate: VerifyGateInput,
): { approved: true } | { approved: false; reason: SinkGateDenial } =>
  assessSink({
    mode: row.egressMode === 'aggregate' ? 'aggregate' : 'pseudonymous',
    state: row.state === 'disabled' ? 'disabled' : row.state === 'enabled' ? 'enabled' : 'pending_verification',
    payloadSchemaVersion: row.payloadSchemaVersion,
    capabilities: gate.capabilities,
    processorReview: gate.processorReview,
    httpsPolicyApproved: gate.httpsPolicyApproved,
  })

const verifyRow = async (
  row: AnalyticsSinkRow,
  gate: VerifyGateInput,
  deps: SinkServiceDeps,
): Promise<{ ok: true } | { ok: false; failureClass: string }> => {
  const gateResult = runGate(row, gate)
  if (!gateResult.approved) return { ok: false, failureClass: gateResult.reason }
  const { endpoint, secret } = decryptRow(row, deps)
  const probeResult = await deps.probe({ endpoint, secret, kind: row.kind, egressMode: row.egressMode })
  if (!probeResult.ok) return { ok: false, failureClass: probeResult.failureClass ?? 'unknown' }
  return { ok: true }
}

export type VerifySinkVersionInput = Readonly<{ sinkVersionId: string; nowMs: number }> & VerifyGateInput

export type VerifySinkVersionResult =
  | Readonly<{ status: 'enabled'; view: SinkPublicView }>
  | Readonly<{ status: 'verification_failed'; failureClass: string }>
  | Readonly<{ status: 'gate_denied'; reason: SinkGateDenial }>
  | Readonly<{ status: 'not_pending' }>
  | Readonly<{ status: 'not_found' }>

export const verifySinkVersion = async (
  input: VerifySinkVersionInput,
  deps: SinkServiceDeps,
): Promise<VerifySinkVersionResult> => {
  const db = deps.getDrizzleDb()
  const row = db.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, input.sinkVersionId)).get()
  if (row === undefined) return { status: 'not_found' }
  if (row.state !== 'pending_verification') return { status: 'not_pending' }
  const gateResult = runGate(row, input)
  if (!gateResult.approved) {
    log.warn({ logicalSinkId: row.logicalSinkId, version: row.version }, 'sink verification denied by capability gate')
    return { status: 'gate_denied', reason: gateResult.reason }
  }
  const outcome = await verifyRow(row, input, deps)
  if (!outcome.ok) {
    log.warn({ logicalSinkId: row.logicalSinkId, version: row.version }, 'sink verification probe failed')
    return { status: 'verification_failed', failureClass: outcome.failureClass }
  }
  db.update(analyticsSinks)
    .set({ state: 'enabled', verifiedAtMs: input.nowMs })
    .where(eq(analyticsSinks.sinkVersionId, input.sinkVersionId))
    .run()
  const updated = db.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, input.sinkVersionId)).get()
  if (updated === undefined) throw new Error('sink version vanished after verification')
  log.info({ logicalSinkId: row.logicalSinkId, version: row.version }, 'sink version enabled')
  return { status: 'enabled', view: toPublicView(updated) }
}

export type RotateSinkVersionInput = CreateSinkVersionInput & VerifyGateInput

export type RotateSinkVersionResult =
  | Readonly<{ status: 'rotated'; view: SinkPublicView }>
  | Readonly<{ status: 'verification_failed'; failureClass: string }>
  | Readonly<{ status: 'gate_denied'; reason: SinkGateDenial }>
  | Readonly<{ status: 'no_predecessor' }>

export const rotateSinkVersion = async (
  input: RotateSinkVersionInput,
  deps: SinkServiceDeps,
): Promise<RotateSinkVersionResult> => {
  const db = deps.getDrizzleDb()
  const predecessor = db
    .select()
    .from(analyticsSinks)
    .where(and(eq(analyticsSinks.logicalSinkId, input.logicalSinkId), eq(analyticsSinks.state, 'enabled')))
    .get()
  if (predecessor === undefined) return { status: 'no_predecessor' }

  const successorView = createSinkVersion(input, deps)
  const successor = db
    .select()
    .from(analyticsSinks)
    .where(eq(analyticsSinks.sinkVersionId, successorView.sinkVersionId))
    .get()
  if (successor === undefined) throw new Error('successor sink version missing after create')

  const gateResult = runGate(successor, input)
  if (!gateResult.approved) return { status: 'gate_denied', reason: gateResult.reason }
  const outcome = await verifyRow(successor, input, deps)
  if (!outcome.ok) return { status: 'verification_failed', failureClass: outcome.failureClass }

  const rotated = db.transaction((tx) => {
    tx.update(analyticsSinks)
      .set({ state: 'disabled', disabledAtMs: input.nowMs })
      .where(eq(analyticsSinks.sinkVersionId, predecessor.sinkVersionId))
      .run()
    tx.update(analyticsSinks)
      .set({ state: 'enabled', verifiedAtMs: input.nowMs })
      .where(eq(analyticsSinks.sinkVersionId, successor.sinkVersionId))
      .run()
    const row = tx.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, successor.sinkVersionId)).get()
    if (row === undefined) throw new Error('successor sink version vanished during rotation')
    return row
  })
  log.info({ logicalSinkId: input.logicalSinkId, version: rotated.version }, 'sink version rotated')
  return { status: 'rotated', view: toPublicView(rotated) }
}

export const disableSinkVersion = (
  input: Readonly<{ sinkVersionId: string; nowMs: number }>,
  deps: SinkServiceDeps,
): 'disabled' | 'not_enabled' | 'not_found' => {
  const db = deps.getDrizzleDb()
  const row = db.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, input.sinkVersionId)).get()
  if (row === undefined) return 'not_found'
  if (row.state !== 'enabled') return 'not_enabled'
  db.update(analyticsSinks)
    .set({ state: 'disabled', disabledAtMs: input.nowMs })
    .where(eq(analyticsSinks.sinkVersionId, input.sinkVersionId))
    .run()
  log.info({ logicalSinkId: row.logicalSinkId, version: row.version }, 'sink version disabled')
  return 'disabled'
}

export const getSinkVersion = (sinkVersionId: string, deps: SinkServiceDeps): SinkPublicView | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsSinks)
    .where(eq(analyticsSinks.sinkVersionId, sinkVersionId))
    .get()
  return row === undefined ? null : toPublicView(row)
}

export const hasEnabledSink = (egressMode: 'aggregate' | 'pseudonymous', deps: SinkServiceDeps): boolean =>
  deps
    .getDrizzleDb()
    .select({ sinkVersionId: analyticsSinks.sinkVersionId })
    .from(analyticsSinks)
    .where(and(eq(analyticsSinks.egressMode, egressMode), eq(analyticsSinks.state, 'enabled')))
    .get() !== undefined

export const listSinkVersions = (deps: SinkServiceDeps): SinkPublicView[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsSinks)
    .orderBy(analyticsSinks.logicalSinkId, analyticsSinks.version)
    .all()
    .map(toPublicView)
