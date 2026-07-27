// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { PinnedSendOutcome } from '../../../src/analytics/delivery/pinned-transport.js'
import {
  classifyOutcome,
  createDbSinkConfigLoader,
  resolveSinkForSend,
  sendWithPolicy,
} from '../../../src/analytics/delivery/worker-send.js'
import type { WorkerSinkConfig } from '../../../src/analytics/delivery/worker-send.js'
import { analyticsSinks } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const CONFIG: WorkerSinkConfig = {
  endpoint: 'https://sink.example.com/ingest',
  secret: 'sink-token',
  egressMode: 'aggregate',
  state: 'enabled',
}

describe('classifyOutcome', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('delivered keeps only the receipt hash', () => {
    expect(classifyOutcome({ kind: 'delivered', status: 200, receiptHash: 'a'.repeat(64) })).toEqual({
      outcome: 'delivered',
      remoteReceiptHash: 'a'.repeat(64),
    })
  })

  test('5xx and unknown responses are retryable; other statuses are dead', () => {
    expect(classifyOutcome({ kind: 'responded', status: 503, errorClass: 'http_5xx' })).toEqual({
      outcome: 'retryable',
      errorClass: 'http_5xx',
    })
    expect(classifyOutcome({ kind: 'responded', status: 400, errorClass: 'http_4xx' })).toEqual({
      outcome: 'dead',
      errorClass: 'http_4xx',
    })
    expect(classifyOutcome({ kind: 'responded', status: 401, errorClass: 'auth' })).toEqual({
      outcome: 'dead',
      errorClass: 'auth',
    })
  })

  test('timeout and uncertain network outcomes are ambiguous; pre-send network is retryable', () => {
    expect(classifyOutcome({ kind: 'timeout' })).toEqual({ outcome: 'ambiguous', errorClass: 'timeout' })
    expect(classifyOutcome({ kind: 'network', acknowledgement: 'uncertain' })).toEqual({
      outcome: 'ambiguous',
      errorClass: 'network',
    })
    expect(classifyOutcome({ kind: 'network', acknowledgement: 'none' })).toEqual({
      outcome: 'retryable',
      errorClass: 'network',
    })
  })

  test('policy outcomes are dead', () => {
    expect(classifyOutcome({ kind: 'policy', reason: 'body_too_large' })).toEqual({
      outcome: 'dead',
      errorClass: 'policy',
    })
  })
})

describe('sendWithPolicy', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('an endpoint policy rejection is a dead policy classification, never a throw', async () => {
    const result = await sendWithPolicy({ ...CONFIG, endpoint: 'http://insecure.example.com/x' }, '{}', {})
    expect(result).toEqual({ outcome: 'dead', errorClass: 'policy' })
  })

  test('a delivered transport outcome carries the receipt hash through', async () => {
    const outcome: PinnedSendOutcome = { kind: 'delivered', status: 200, receiptHash: 'b'.repeat(64) }
    const result = await sendWithPolicy(CONFIG, '{}', {
      lookupAll: () => Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
      transport: () => Promise.resolve(outcome),
    })
    expect(result).toEqual({ outcome: 'delivered', remoteReceiptHash: 'b'.repeat(64) })
  })
})

describe('sink config resolution', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('a missing sink row resolves to null', () => {
    const loader = createDbSinkConfigLoader({ getDrizzleDb: (): Db => db })
    expect(loader('sv-missing')).toBeNull()
  })

  test('an undecryptable sink row resolves to null instead of throwing', () => {
    db.insert(analyticsSinks)
      .values({
        sinkVersionId: 'sv-broken',
        logicalSinkId: 'logical-broken',
        version: 1,
        kind: 'webhook',
        state: 'enabled',
        payloadSchemaVersion: 1,
        egressMode: 'aggregate',
        endpointCiphertext: 'not-a-valid-ciphertext',
        secretCiphertext: 'not-a-valid-ciphertext',
        configFingerprint: 'fp-broken',
        createdAtMs: 1_800_000_000_000,
      })
      .run()
    const loader = createDbSinkConfigLoader({ getDrizzleDb: (): Db => db })
    expect(loader('sv-broken')).toBeNull()
  })

  test('a disabled sink is refused by resolveSinkForSend', () => {
    const deps = {
      getDrizzleDb: (): Db => db,
      loadSinkConfig: (): WorkerSinkConfig => ({ ...CONFIG, state: 'disabled' }),
    }
    expect(resolveSinkForSend(deps, 'sv-1')).toBeNull()
  })
})
