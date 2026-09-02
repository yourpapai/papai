// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { FindingsSidecarSchema, SkepticFindingsSidecarSchema } from '../../afk-runner/src/agent-schemas.js'

const FINDING = {
  id: 'F1',
  class: 'MATERIAL',
  gap: 'the proposal never names the scope id',
  question: 'q',
  code_evidence_attempted: 'e',
} as const

describe('SkepticFindingsSidecarSchema (loop-memory D2)', () => {
  it('accepts S-prefixed ids and rejects reviewer-namespaced ones', () => {
    expect(SkepticFindingsSidecarSchema.safeParse({ findings: [{ ...FINDING, id: 'S1' }] }).success).toBe(true)
    expect(SkepticFindingsSidecarSchema.safeParse({ findings: [FINDING] }).success).toBe(false)
  })

  it('leaves the reviewer-side schema string-keyed', () => {
    expect(FindingsSidecarSchema.safeParse({ findings: [FINDING] }).success).toBe(true)
  })
})
