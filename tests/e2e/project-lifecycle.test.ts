// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { listColumns } from '../../src/providers/kaneo/list-columns.js'
import { listProjects } from '../../src/providers/kaneo/list-projects.js'
import { updateProject } from '../../src/providers/kaneo/update-project.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Project Lifecycle', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('creates and lists projects', async () => {
    const project = await testClient.createTestProject(`List Test ${Date.now()}`)

    const projects = await listProjects({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
    })
    const found = projects.find((p) => p.id === project.id)
    expect(found?.name).toBe(project.name)
  })

  test('updates a project', async () => {
    const project = await testClient.createTestProject(`Update Test ${Date.now()}`)

    const updated = await updateProject({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      projectId: project.id,
      name: 'Updated Project Name',
    })

    expect(updated.name).toBe('Updated Project Name')

    // Verify via re-fetch
    const projects = await listProjects({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
    })
    const refetched = projects.find((p) => p.id === project.id)
    expect(refetched?.name).toBe('Updated Project Name')
  })

  test('lists columns in a project', async () => {
    const project = await testClient.createTestProject(`Column Test ${Date.now()}`)

    const columns = await listColumns({ config: kaneoConfig, projectId: project.id })
    expect(columns.length).toBeGreaterThan(0)
    expect(columns[0]).toHaveProperty('name')
    expect(columns[0]).toHaveProperty('id')
  })

  test('throws error when updating non-existent project', async () => {
    const promise = updateProject({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      projectId: 'non-existent-id',
      name: 'X',
    })
    await expect(promise).rejects.toThrow()
  })
})
