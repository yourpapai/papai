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
  // Task 4 (real-Kaneo binding) reclassified 9 groups from PARITY_GROUPS to
  // PARITY_EXCLUSIONS, each for genuine real-Kaneo drift (not fixable by correcting
  // the fake) documented in their PARITY_EXCLUSIONS reason below:
  //   - task-list-filter, label-crud, status-crud, status-reorder: real Kaneo rejects
  //     or reshapes the operation itself (validation, deletion semantics, column
  //     schema shape, seeded default columns).
  //   - task-create, task-get, task-update, comment-crud, identity: real Kaneo's
  //     response schema mandates fields (status/priority/createdAt on tasks,
  //     createdAt on comments, a synthesized unique email login on member
  //     provisioning) that are always present and can never be suppressed to match
  //     MemoryTaskProvider's minimal-echo shape.
  // 16 - 9 = 7 groups remain; 15 + 9 = 24 exclusions.
  test('declares 7 parity groups with unique ids', () => {
    expect(PARITY_GROUPS).toHaveLength(7)
    expect(new Set(PARITY_GROUPS.map((group) => group.id)).size).toBe(7)
  })

  test('records a reason for every excluded group', () => {
    expect(PARITY_EXCLUSIONS.length).toBeGreaterThanOrEqual(24)
    expect(PARITY_EXCLUSIONS.every((exclusion) => exclusion.reason.includes('KaneoProvider'))).toBe(true)
  })

  for (const group of PARITY_GROUPS) {
    test(group.title, async () => {
      const harness = await makeFakeHarness()
      await group.run(harness)
    })
  }
})
