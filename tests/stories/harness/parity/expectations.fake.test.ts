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
  test('declares 16 parity groups with unique ids', () => {
    expect(PARITY_GROUPS).toHaveLength(16)
    expect(new Set(PARITY_GROUPS.map((group) => group.id)).size).toBe(16)
  })

  test('records a reason for every fake-only excluded group', () => {
    expect(PARITY_EXCLUSIONS.length).toBeGreaterThanOrEqual(15)
    expect(PARITY_EXCLUSIONS.every((exclusion) => exclusion.reason.includes('KaneoProvider'))).toBe(true)
  })

  for (const group of PARITY_GROUPS) {
    test(group.title, async () => {
      const harness = await makeFakeHarness()
      await group.run(harness)
    })
  }
})
