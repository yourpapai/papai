// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assessStageEEntry, REQUIRED_PRIVACY_CONTROLS } from '../../../src/analytics/rollout/stage-gates.js'
import '../rollout-gates.test.js'

describe('stage-gates module mirror', () => {
  test('freezes the 17-control contract and refuses Stage E for a disabled sink', () => {
    expect(REQUIRED_PRIVACY_CONTROLS).toBe(17)
    const decision = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: {
        mode: 'pseudonymous',
        state: 'disabled',
        payloadSchemaVersion: 1,
        capabilities: { callerControlledIdempotency: true, deterministicReconciliation: true, deleteActor: true },
        processorReview: {
          subprocessorReviewed: true,
          residencyReviewed: true,
          deletionPathReviewed: true,
          incidentReviewed: true,
          transferReviewed: true,
          noSecondaryUse: true,
        },
        httpsPolicyApproved: true,
      },
    })
    expect(decision.allowed).toBe(false)
  })
})
