// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  contextVaultFiles,
  contextVaultIndexerState,
  contextVaultSpecs,
  contextVaultTokens,
} from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('context vault schema', () => {
  test('inserts and reads a token row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(contextVaultTokens)
      .values({
        configContextId: 'pi:telegram:grp:1',
        tokenId: 'tok-1',
        label: 'laptop indexer',
        tokenHash: 'a'.repeat(64),
        createdAt: 1710000000000,
      })
      .run()

    const row = getDrizzleDb().select().from(contextVaultTokens).get()
    expect(row).toEqual({
      configContextId: 'pi:telegram:grp:1',
      tokenId: 'tok-1',
      label: 'laptop indexer',
      tokenHash: 'a'.repeat(64),
      createdAt: 1710000000000,
      lastUsedAt: null,
      revokedAt: null,
    })
  })

  test('inserts and reads a spec row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(contextVaultSpecs)
      .values({
        configContextId: 'pi:telegram:grp:1',
        id: 'papai:context-vault-plugin',
        repo: 'papai',
        changeName: 'context-vault-plugin',
        oneLine: 'external memory for coding sessions',
        summary: 'A summary',
        outline: JSON.stringify(['## Context', '## Schema']),
        stage: 'in-progress',
        progressPct: 40,
        mtime: 1710000000000,
        sourceHash: 'b'.repeat(64),
      })
      .run()

    const row = getDrizzleDb().select().from(contextVaultSpecs).get()
    expect(row).toEqual({
      configContextId: 'pi:telegram:grp:1',
      id: 'papai:context-vault-plugin',
      repo: 'papai',
      changeName: 'context-vault-plugin',
      oneLine: 'external memory for coding sessions',
      summary: 'A summary',
      outline: JSON.stringify(['## Context', '## Schema']),
      stage: 'in-progress',
      progressPct: 40,
      mtime: 1710000000000,
      sourceHash: 'b'.repeat(64),
    })
  })

  test('inserts and reads a file row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(contextVaultFiles)
      .values({
        configContextId: 'pi:telegram:grp:1',
        specId: 'papai:context-vault-plugin',
        path: 'openspec/changes/context-vault-plugin/tasks.md',
        kind: 'tasks',
        hash: 'c'.repeat(64),
        mtime: 1710000000000,
      })
      .run()

    const row = getDrizzleDb().select().from(contextVaultFiles).get()
    expect(row).toEqual({
      configContextId: 'pi:telegram:grp:1',
      specId: 'papai:context-vault-plugin',
      path: 'openspec/changes/context-vault-plugin/tasks.md',
      kind: 'tasks',
      hash: 'c'.repeat(64),
      mtime: 1710000000000,
    })
  })

  test('inserts and reads an indexer state row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(contextVaultIndexerState)
      .values({
        configContextId: 'pi:telegram:grp:1',
        lastPushAt: 1710000000000,
      })
      .run()

    const row = getDrizzleDb().select().from(contextVaultIndexerState).get()
    expect(row).toEqual({
      configContextId: 'pi:telegram:grp:1',
      lastPushAt: 1710000000000,
    })
  })
})
