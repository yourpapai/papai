// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { applyPush, type PushFileInput } from '../../src/context-vault/spec-store.js'
import {
  contextVaultFiles,
  contextVaultIndexerState,
  contextVaultSpecs,
  type ContextVaultFileRow,
  type ContextVaultIndexerStateRow,
  type ContextVaultSpecRow,
} from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX_A = 'pi:telegram:grp:a'
const CTX_B = 'pi:telegram:grp:b'

const file = (path: string, hash: string, mtime = 1710000000000): PushFileInput => ({
  path,
  kind: 'proposal',
  hash,
  mtime,
  text: '# Title\n\nbody',
})

const getSpec = (ctx: string, id: string): ContextVaultSpecRow | undefined =>
  getDrizzleDb()
    .select()
    .from(contextVaultSpecs)
    .where(and(eq(contextVaultSpecs.configContextId, ctx), eq(contextVaultSpecs.id, id)))
    .get()

const getFiles = (ctx: string, specId: string): ContextVaultFileRow[] =>
  getDrizzleDb()
    .select()
    .from(contextVaultFiles)
    .where(and(eq(contextVaultFiles.configContextId, ctx), eq(contextVaultFiles.specId, specId)))
    .all()

const getIndexerState = (ctx: string): ContextVaultIndexerStateRow | undefined =>
  getDrizzleDb().select().from(contextVaultIndexerState).where(eq(contextVaultIndexerState.configContextId, ctx)).get()

describe('context-vault spec-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('push creates the spec row and file rows keyed by (config_context_id, id, path)', () => {
    const result = applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [
        file('openspec/changes/context-vault-plugin/proposal.md', 'h1'),
        file('openspec/changes/context-vault-plugin/tasks.md', 'h2'),
      ],
      deletions: [],
    })

    expect(result.specId).toBe('papai:context-vault-plugin')
    expect(result.changedPaths.sort()).toEqual([
      'openspec/changes/context-vault-plugin/proposal.md',
      'openspec/changes/context-vault-plugin/tasks.md',
    ])

    const spec = getSpec(CTX_A, 'papai:context-vault-plugin')
    expect(spec?.repo).toBe('papai')
    expect(spec?.changeName).toBe('context-vault-plugin')
    expect(getFiles(CTX_A, 'papai:context-vault-plugin')).toHaveLength(2)
  })

  test('re-push with identical hashes is a no-op', () => {
    const input = {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1')],
      deletions: [] as string[],
    }
    applyPush(CTX_A, input)
    const before = getSpec(CTX_A, 'papai:context-vault-plugin')

    const second = applyPush(CTX_A, input)
    expect(second.changedPaths).toEqual([])
    expect(getSpec(CTX_A, 'papai:context-vault-plugin')?.sourceHash).toBe(before?.sourceHash)
  })

  test('changed hash updates the file row and reports the path', () => {
    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1'), file('a/tasks.md', 'h2')],
      deletions: [],
    })

    const result = applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1'), file('a/tasks.md', 'h2-changed')],
      deletions: [],
    })
    expect(result.changedPaths).toEqual(['a/tasks.md'])
    const tasks = getFiles(CTX_A, 'papai:context-vault-plugin').find((f) => f.path === 'a/tasks.md')
    expect(tasks?.hash).toBe('h2-changed')
  })

  test('deletions remove file rows', () => {
    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1'), file('a/design.md', 'h3')],
      deletions: [],
    })

    const result = applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [],
      deletions: ['a/design.md'],
    })
    expect(result.deletedPaths).toEqual(['a/design.md'])
    expect(getFiles(CTX_A, 'papai:context-vault-plugin').map((f) => f.path)).toEqual(['a/proposal.md'])
    expect(getSpec(CTX_A, 'papai:context-vault-plugin')).toBeDefined()
  })

  test('deleting the last remaining file drops the empty spec shell', () => {
    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1')],
      deletions: [],
    })

    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [],
      deletions: ['a/proposal.md'],
    })
    expect(getSpec(CTX_A, 'papai:context-vault-plugin')).toBeUndefined()
    expect(getFiles(CTX_A, 'papai:context-vault-plugin')).toEqual([])
  })

  test('push updates indexer_state last_push_at for the config context', () => {
    expect(getIndexerState(CTX_A)).toBeUndefined()

    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1')],
      deletions: [],
    })
    const first = getIndexerState(CTX_A)
    expect(first?.lastPushAt).not.toBeUndefined()
    expect(typeof first?.lastPushAt).toBe('number')
  })

  test('specs are isolated per config context', () => {
    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1')],
      deletions: [],
    })

    expect(getSpec(CTX_B, 'papai:context-vault-plugin')).toBeUndefined()
    expect(getFiles(CTX_B, 'papai:context-vault-plugin')).toEqual([])
    expect(getIndexerState(CTX_B)).toBeUndefined()
  })

  test('re-push preserves an existing LLM-written summary', () => {
    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1')],
      deletions: [],
    })
    getDrizzleDb()
      .update(contextVaultSpecs)
      .set({ oneLine: 'external memory', summary: 'LLM summary' })
      .where(and(eq(contextVaultSpecs.configContextId, CTX_A), eq(contextVaultSpecs.id, 'papai:context-vault-plugin')))
      .run()

    applyPush(CTX_A, {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [file('a/proposal.md', 'h1-new')],
      deletions: [],
    })
    const spec = getSpec(CTX_A, 'papai:context-vault-plugin')
    expect(spec?.oneLine).toBe('external memory')
    expect(spec?.summary).toBe('LLM summary')
  })
})
