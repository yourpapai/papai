// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createColumn } from '../../src/providers/kaneo/create-column.js'
import { deleteColumn } from '../../src/providers/kaneo/delete-column.js'
import { listColumns } from '../../src/providers/kaneo/list-columns.js'
import { reorderColumns } from '../../src/providers/kaneo/reorder-columns.js'
import { updateColumn } from '../../src/providers/kaneo/update-column.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Column Management', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string
  const createdColumnIds: string[] = []

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()

    // Clean up columns - sequential is intentional to handle individual errors
    for (const columnId of createdColumnIds) {
      try {
        await deleteColumn({ config: kaneoConfig, columnId })
      } catch {
        /* ignore */
      }
    }
    createdColumnIds.length = 0

    const project = await testClient.createTestProject(`Column Test ${Date.now()}`)
    projectId = project.id
  })

  test('creates a column with all properties', async () => {
    const columnName = `In Review ${Date.now()}`
    const column = await createColumn({
      config: kaneoConfig,
      projectId,
      name: columnName,
      icon: '👀',
      color: '#FFA500',
      isFinal: false,
    })
    createdColumnIds.push(column.id)

    expect(column.name).toBe(columnName)
    expect(column.icon).toBe('👀')
    expect(column.color).toBe('#FFA500')
    expect(column.isFinal).toBe(false)
  })

  test('creates a final column', async () => {
    const columnName = `Done ${Date.now()}`
    const column = await createColumn({
      config: kaneoConfig,
      projectId,
      name: columnName,
      isFinal: true,
    })
    createdColumnIds.push(column.id)

    expect(column.isFinal).toBe(true)
  })

  test('lists columns in project', async () => {
    // Create some custom columns
    const col1Name = `Backlog ${Date.now()}`
    const col2Name = `In Progress ${Date.now()}`
    const col1 = await createColumn({ config: kaneoConfig, projectId, name: col1Name })
    const col2 = await createColumn({ config: kaneoConfig, projectId, name: col2Name })
    createdColumnIds.push(col1.id, col2.id)

    const columns = await listColumns({ config: kaneoConfig, projectId })

    expect(columns.length).toBeGreaterThanOrEqual(2)
    const names = columns.map((c) => c.name)
    expect(names).toContain(col1Name)
    expect(names).toContain(col2Name)
  })

  test('updates column name', async () => {
    const columnName = `Old Name ${Date.now()}`
    const column = await createColumn({ config: kaneoConfig, projectId, name: columnName })
    createdColumnIds.push(column.id)

    const updated = await updateColumn({
      config: kaneoConfig,
      columnId: column.id,
      name: 'New Name',
    })

    expect(updated.name).toBe('New Name')

    // Verify via re-fetch
    const columns = await listColumns({ config: kaneoConfig, projectId })
    const refetched = columns.find((c) => c.id === column.id)
    expect(refetched?.name).toBe('New Name')
  })

  test('updates column color and icon', async () => {
    const columnName = `Status ${Date.now()}`
    const column = await createColumn({ config: kaneoConfig, projectId, name: columnName })
    createdColumnIds.push(column.id)

    const updated = await updateColumn({
      config: kaneoConfig,
      columnId: column.id,
      color: '#00FF00',
      icon: '✅',
    })

    expect(updated.color).toBe('#00FF00')
    expect(updated.icon).toBe('✅')

    // Verify via re-fetch
    const columns = await listColumns({ config: kaneoConfig, projectId })
    const refetched = columns.find((c) => c.id === column.id)
    expect(refetched?.color).toBe('#00FF00')
    expect(refetched?.icon).toBe('✅')
  })

  test('reorders columns', async () => {
    const col1 = await createColumn({ config: kaneoConfig, projectId, name: `First ${Date.now()}` })
    const col2 = await createColumn({ config: kaneoConfig, projectId, name: `Second ${Date.now()}` })
    const col3 = await createColumn({ config: kaneoConfig, projectId, name: `Third ${Date.now()}` })
    createdColumnIds.push(col1.id, col2.id, col3.id)

    // Reverse the order
    await reorderColumns({
      config: kaneoConfig,
      projectId,
      columns: [
        { id: col3.id, position: 0 },
        { id: col2.id, position: 1 },
        { id: col1.id, position: 2 },
      ],
    })

    const columns = await listColumns({ config: kaneoConfig, projectId })
    const customColumns = columns.filter((c) => [col1.id, col2.id, col3.id].includes(c.id))

    expect(customColumns[0]?.id).toBe(col3.id)
    expect(customColumns[1]?.id).toBe(col2.id)
    expect(customColumns[2]?.id).toBe(col1.id)
  })

  test('deletes a column', async () => {
    const column = await createColumn({ config: kaneoConfig, projectId, name: `To Delete ${Date.now()}` })

    await deleteColumn({ config: kaneoConfig, columnId: column.id })

    const columns = await listColumns({ config: kaneoConfig, projectId })
    const found = columns.find((c) => c.id === column.id)
    expect(found).toBeUndefined()
  })

  test('creates column without optional properties', async () => {
    const columnName = `Simple Column ${Date.now()}`
    const column = await createColumn({ config: kaneoConfig, projectId, name: columnName })
    createdColumnIds.push(column.id)

    expect(column.name).toBe(columnName)
  })

  test('throws error when updating non-existent column', async () => {
    const promise = updateColumn({
      config: kaneoConfig,
      columnId: 'non-existent-id',
      name: 'X',
    })
    await expect(promise).rejects.toThrow()
  })

  test('throws error when deleting non-existent column', async () => {
    const promise = deleteColumn({
      config: kaneoConfig,
      columnId: 'non-existent-id',
    })
    await expect(promise).rejects.toThrow()
  })
})
