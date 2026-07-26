// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assessSink } from '../../../src/analytics/delivery/sink.js'
import type { AssessSinkInput, SinkCapabilities } from '../../../src/analytics/delivery/sink.js'

const FULL_CAPABILITIES: SinkCapabilities = {
  callerControlledIdempotency: true,
  deterministicReconciliation: true,
  deleteActor: true,
}

const REVIEWED_PROCESSOR = {
  subprocessorReviewed: true,
  residencyReviewed: true,
  deletionPathReviewed: true,
  incidentReviewed: true,
  transferReviewed: true,
  noSecondaryUse: true,
}

const baseInput = (overrides: Partial<AssessSinkInput> = {}): AssessSinkInput => ({
  mode: 'pseudonymous',
  state: 'enabled',
  payloadSchemaVersion: 1,
  capabilities: FULL_CAPABILITIES,
  processorReview: REVIEWED_PROCESSOR,
  httpsPolicyApproved: true,
  ...overrides,
})

describe('analytics sink capability gate', () => {
  test('an approved pseudonymous sink passes the strict AND of all gates', () => {
    expect(assessSink(baseInput())).toEqual({ approved: true })
  })

  test('an aggregate-only sink is approved without actor-level capabilities', () => {
    const result = assessSink(
      baseInput({
        mode: 'aggregate',
        capabilities: {
          callerControlledIdempotency: false,
          deterministicReconciliation: false,
          deleteActor: false,
        },
      }),
    )
    expect(result).toEqual({ approved: true })
  })

  test('an aggregate-only sink is never approved for pseudonymous egress', () => {
    const result = assessSink(
      baseInput({
        capabilities: {
          callerControlledIdempotency: false,
          deterministicReconciliation: false,
          deleteActor: false,
        },
      }),
    )
    expect(result.approved).toBe(false)
  })

  test('missing actor deletion blocks pseudonymous approval', () => {
    expect(assessSink(baseInput({ capabilities: { ...FULL_CAPABILITIES, deleteActor: false } }))).toEqual({
      approved: false,
      reason: 'missing_delete_actor',
    })
  })

  test('missing deterministic reconciliation blocks pseudonymous approval', () => {
    expect(
      assessSink(baseInput({ capabilities: { ...FULL_CAPABILITIES, deterministicReconciliation: false } })),
    ).toEqual({ approved: false, reason: 'missing_deterministic_reconciliation' })
  })

  test('missing caller-controlled destination idempotency blocks pseudonymous approval', () => {
    expect(
      assessSink(baseInput({ capabilities: { ...FULL_CAPABILITIES, callerControlledIdempotency: false } })),
    ).toEqual({ approved: false, reason: 'missing_caller_controlled_idempotency' })
  })

  test('a disabled sink is never approved', () => {
    expect(assessSink(baseInput({ state: 'disabled' }))).toEqual({ approved: false, reason: 'sink_disabled' })
    expect(assessSink(baseInput({ mode: 'aggregate', state: 'disabled' }))).toEqual({
      approved: false,
      reason: 'sink_disabled',
    })
  })

  test('an unpinned payload schema is never approved', () => {
    expect(assessSink(baseInput({ payloadSchemaVersion: 2 }))).toEqual({
      approved: false,
      reason: 'payload_schema_unpinned',
    })
  })

  test('an HTTPS policy rejection is never approved', () => {
    expect(assessSink(baseInput({ httpsPolicyApproved: false }))).toEqual({
      approved: false,
      reason: 'https_policy_not_approved',
    })
  })

  test('an incomplete processor review is never approved', () => {
    expect(assessSink(baseInput({ processorReview: { ...REVIEWED_PROCESSOR, residencyReviewed: false } }))).toEqual({
      approved: false,
      reason: 'processor_review_incomplete',
    })
    expect(assessSink(baseInput({ processorReview: { ...REVIEWED_PROCESSOR, noSecondaryUse: false } }))).toEqual({
      approved: false,
      reason: 'processor_review_incomplete',
    })
  })

  test('no capability substitutes for another', () => {
    const caps: (keyof SinkCapabilities)[] = [
      'callerControlledIdempotency',
      'deterministicReconciliation',
      'deleteActor',
    ]
    for (const missing of caps) {
      const result = assessSink(baseInput({ capabilities: { ...FULL_CAPABILITIES, [missing]: false } }))
      expect(result.approved).toBe(false)
    }
  })

  test('OpenPanel fixture: reconciliation alone cannot rescue failed idempotency and erasure gates', () => {
    const openPanel = baseInput({
      capabilities: {
        callerControlledIdempotency: false,
        deterministicReconciliation: true,
        deleteActor: false,
      },
    })
    const result = assessSink(openPanel)
    expect(result.approved).toBe(false)
    expect(assessSink({ ...openPanel, mode: 'aggregate' })).toEqual({ approved: true })
  })
})
