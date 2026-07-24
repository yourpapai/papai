// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MemoryTaskProvider } from '../memory-task-provider.js'
import { PARITY_EXCLUSIONS, PARITY_GROUPS, type ParityHarness } from './expectations.js'

async function makeFakeHarness(): Promise<ParityHarness> {
  const provider = new MemoryTaskProvider()
  const project = await provider.createProject({ name: 'Parity Project' })
  return { provider, projectId: project.id }
}

describe('provider parity — fake binding (MemoryTaskProvider)', () => {
  // PARITY_GROUPS is the concatenation of the per-domain arrays in ./expectations/.
  // The two count assertions below track its length and PARITY_EXCLUSIONS; bump them
  // whenever a group or exclusion is added. See
  // docs/superpowers/plans/2026-07-24-tier1b-e2e-parity-retrofit.md for the retrofit.
  test('declares 28 parity groups with unique ids', () => {
    expect(PARITY_GROUPS).toHaveLength(28)
    expect(new Set(PARITY_GROUPS.map((group) => group.id)).size).toBe(28)
  })

  test('records a reason for every excluded group', () => {
    expect(PARITY_EXCLUSIONS.length).toBeGreaterThanOrEqual(19)
    expect(PARITY_EXCLUSIONS.every((exclusion) => exclusion.reason.includes('KaneoProvider'))).toBe(true)
  })

  for (const group of PARITY_GROUPS) {
    test(group.title, async () => {
      const harness = await makeFakeHarness()
      await group.run(harness)
    })
  }
})
