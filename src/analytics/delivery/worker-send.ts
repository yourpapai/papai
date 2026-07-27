// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsSinks } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { decryptSecretPayload } from '../../secret-payload-crypto.js'
import { approveSinkEndpoint, buildSinkAuthHeaders } from './http-policy.js'
import type { LookupAll } from './http-policy.js'
import { createPinnedTransport } from './pinned-transport.js'
import type { PinnedSendOutcome, PinnedTransport } from './pinned-transport.js'
import type { DeliveryErrorClass } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:worker-send' })

export type WorkerSinkConfig = Readonly<{
  endpoint: string
  secret: string
  egressMode: string
  state: string
}>

export type SinkConfigLoader = (sinkVersionId: string) => WorkerSinkConfig | null

export type EgressSendDeps = Readonly<{
  transport?: PinnedTransport
  lookupAll?: LookupAll
}>

export type SinkConfigDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  loadSinkConfig?: SinkConfigLoader
}>

export type Classification = Readonly<{
  outcome: 'delivered' | 'retryable' | 'ambiguous' | 'dead'
  remoteReceiptHash?: string
  errorClass?: DeliveryErrorClass
}>

export const classifyOutcome = (outcome: PinnedSendOutcome): Classification => {
  if (outcome.kind === 'delivered') return { outcome: 'delivered', remoteReceiptHash: outcome.receiptHash }
  if (outcome.kind === 'responded') {
    if (outcome.errorClass === 'http_5xx' || outcome.errorClass === 'unknown') {
      return { outcome: 'retryable', errorClass: outcome.errorClass }
    }
    return { outcome: 'dead', errorClass: outcome.errorClass }
  }
  if (outcome.kind === 'timeout') return { outcome: 'ambiguous', errorClass: 'timeout' }
  if (outcome.kind === 'network') {
    return outcome.acknowledgement === 'uncertain'
      ? { outcome: 'ambiguous', errorClass: 'network' }
      : { outcome: 'retryable', errorClass: 'network' }
  }
  return { outcome: 'dead', errorClass: 'policy' }
}

export const sendWithPolicy = async (
  config: WorkerSinkConfig,
  body: string,
  deps: EgressSendDeps,
): Promise<Classification> => {
  const transport = deps.transport ?? createPinnedTransport()
  try {
    const approved = await approveSinkEndpoint(config.endpoint, { lookupAll: deps.lookupAll })
    const outcome = await transport(approved, { headers: buildSinkAuthHeaders(config.secret), body })
    return classifyOutcome(outcome)
  } catch {
    log.warn({ errorClass: 'policy' }, 'egress failed before send: endpoint policy rejection')
    return { outcome: 'dead', errorClass: 'policy' }
  }
}

export const createDbSinkConfigLoader = (
  deps: Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>,
): SinkConfigLoader => {
  return (sinkVersionId) => {
    const row = deps
      .getDrizzleDb()
      .select()
      .from(analyticsSinks)
      .where(sql`${analyticsSinks.sinkVersionId} = ${sinkVersionId}`)
      .get()
    if (row === undefined) return null
    try {
      const endpoint = decryptSecretPayload(row.endpointCiphertext)['endpoint']
      const secret = decryptSecretPayload(row.secretCiphertext)['secret']
      if (endpoint === undefined || secret === undefined) return null
      return { endpoint, secret, egressMode: row.egressMode, state: row.state }
    } catch {
      log.warn({ sinkVersionId }, 'sink config could not be decrypted')
      return null
    }
  }
}

export const resolveSinkForSend = (deps: SinkConfigDeps, sinkVersionId: string): WorkerSinkConfig | null => {
  const loader = deps.loadSinkConfig ?? createDbSinkConfigLoader(deps)
  const config = loader(sinkVersionId)
  if (config === null || config.state !== 'enabled') return null
  return config
}
