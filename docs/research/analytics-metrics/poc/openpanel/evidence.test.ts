// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { buildRunEvidence } from './evidence.js'

test('emits only aggregate, synthetic-safe delivery evidence', () => {
  const evidence = buildRunEvidence({
    baseUrl: 'http://127.0.0.1:4400',
    fixtureSha256: 'd'.repeat(64),
    forwarder: {
      ambiguousThisRun: 1,
      attempted: 11,
      deliveredThisRun: 10,
      enqueued: 11,
      ledger: { ambiguous: 1, attempts: 11, dead: 0, delivered: 10, pending: 0, total: 11 },
      permanentThisRun: 0,
      retryableThisRun: 0,
    },
    profileEventCount: 10,
    selectedEventCount: 11,
    simulateAmbiguousSuccesses: 1,
    sinkId: 'openpanel-local',
    sourceEventCount: 17_183,
  })
  const serialized = JSON.stringify(evidence)

  expect(evidence.schema).toBe('papai.openpanel.poc.run.v1')
  expect(evidence.synthetic_only).toBe(true)
  expect(evidence.delivery.ledger.total).toBe(11)
  expect(serialized).not.toContain('secret')
  expect(serialized).not.toContain('profileId')
  expect(serialized).not.toContain('syn_')
  expect(evidence.limitations).toContain('queue_ack_is_not_durable_query_visibility')
  expect(evidence.limitations).toContain('native_session_fidelity_failed_observed')
})
