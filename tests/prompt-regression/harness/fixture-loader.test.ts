// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { partitionFixtures, validateFixtureMeta } from './fixture-loader.js'
import type { AssemblyFixture } from './fixture-types.js'

const runnableFixture: AssemblyFixture = {
  kind: 'assembly',
  meta: {
    id: 'assembly-runnable',
    description: 'Runnable fixture',
    ownerArea: 'prompt',
    roadmapPhase: 'phase-0',
  },
  setup: { contextType: 'dm', provider: 'kaneo' },
  expected: {},
}

const pendingFixture: AssemblyFixture = {
  kind: 'assembly',
  meta: {
    id: 'assembly-pending',
    description: 'Pending fixture',
    ownerArea: 'safety',
    roadmapPhase: 'phase-0',
    pending: {
      reason: 'Current prompt does not yet isolate this untrusted content channel.',
      expectedFixPhase: 'phase-3',
      unskipWhen: 'Safety Boundary Spec introduces trust-boundary rendering.',
    },
  },
  setup: { contextType: 'dm', provider: 'kaneo' },
  expected: {},
}

describe('validateFixtureMeta', () => {
  test('accepts runnable fixture metadata', () => {
    expect(() => validateFixtureMeta(runnableFixture.meta)).not.toThrow()
  })

  test('accepts pending fixture metadata with reason, phase, and unskip condition', () => {
    expect(() => validateFixtureMeta(pendingFixture.meta)).not.toThrow()
  })

  test('rejects pending metadata with an empty reason', () => {
    expect(() =>
      validateFixtureMeta({
        ...pendingFixture.meta,
        pending: { ...pendingFixture.meta.pending!, reason: '' },
      }),
    ).toThrow('Pending fixture assembly-pending must include a reason')
  })
})

describe('partitionFixtures', () => {
  test('partitions runnable and pending fixtures', () => {
    const result = partitionFixtures([runnableFixture, pendingFixture])

    expect(result.runnable.map((f) => f.meta.id)).toEqual(['assembly-runnable'])
    expect(result.pending.map((f) => f.meta.id)).toEqual(['assembly-pending'])
  })
})
