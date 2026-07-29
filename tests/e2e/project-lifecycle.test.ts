// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { listColumns } from '../../plugins/task-provider-kaneo/list-columns.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Project Lifecycle', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('lists columns in a project', async () => {
    const project = await testClient.createTestProject(`Column Test ${Date.now()}`)

    const columns = await listColumns({ config: kaneoConfig, projectId: project.id })
    expect(columns.length).toBeGreaterThan(0)
    expect(columns[0]).toHaveProperty('name')
    expect(columns[0]).toHaveProperty('id')
  })
})
