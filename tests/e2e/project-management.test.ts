// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { deleteProject } from '../../plugins/task-provider-kaneo/delete-project.js'
import { listProjects } from '../../plugins/task-provider-kaneo/list-projects.js'
import { updateProject } from '../../plugins/task-provider-kaneo/update-project.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Project Management', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('deletes a project', async () => {
    const project = await testClient.createTestProject(`To Delete ${Date.now()}`)
    await deleteProject({ config: kaneoConfig, projectId: project.id })

    const projects = await listProjects({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
    })
    const found = projects.find((p) => p.id === project.id)
    expect(found).toBeUndefined()
  })

  test('updates project name and description', async () => {
    const project = await testClient.createTestProject(`To Update ${Date.now()}`)

    const updated = await updateProject({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      projectId: project.id,
      name: 'Updated Project Name',
      description: 'Updated description',
    })

    expect(updated.name).toBe('Updated Project Name')
    expect(updated.description).toBe('Updated description')

    // Verify via re-fetch
    const projects = await listProjects({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
    })
    const refetched = projects.find((p) => p.id === project.id)
    expect(refetched?.name).toBe('Updated Project Name')
  })

  test('lists projects in workspace', async () => {
    const project1 = await testClient.createTestProject(`Project A ${Date.now()}`)
    const project2 = await testClient.createTestProject(`Project B ${Date.now()}`)

    const projects = await listProjects({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
    })

    const ids = projects.map((p) => p.id)
    expect(ids).toContain(project1.id)
    expect(ids).toContain(project2.id)
  })
})
