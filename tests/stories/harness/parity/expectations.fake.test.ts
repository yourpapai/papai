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
  //     schema shape, seeded default columns). These remain excluded.
  //   - task-create, task-get, task-update, comment-crud, identity: real Kaneo's
  //     response schema mandates extra fields (status/priority/createdAt on tasks,
  //     createdAt on comments, a synthesized unique email login on member
  //     provisioning) beyond MemoryTaskProvider's minimal-echo shape. Task 4b
  //     restored these 5 to PARITY_GROUPS by relaxing their exact-key-shape
  //     assertions to presence-subset assertions (`toMatchObject`/`toContain`/
  //     type checks) that hold on both bindings without upgrading the fake.
  // 16 - 4 = 12 groups remain; 15 + 4 = 19 exclusions.
  test('declares 12 parity groups with unique ids', () => {
    expect(PARITY_GROUPS).toHaveLength(12)
    expect(new Set(PARITY_GROUPS.map((group) => group.id)).size).toBe(12)
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
