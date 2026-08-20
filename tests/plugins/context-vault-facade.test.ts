// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { applyPush } from '../../src/context-vault/spec-store.js'
import { contextVaultSpecs } from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { buildContextVaultFacade } from '../../src/plugins/context-vault-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const THREAD_CTX = toScopedThreadContextId({
  platformInstanceId: 'pi-test',
  nativeContextId: 'group-7',
  threadId: 'thread-3',
})
const CONFIG_CTX = getConfigContextIdFromStorageContextId(THREAD_CTX)
const OTHER_CTX = 'pi:telegram:grp:other'

const noEnqueue = { enqueueSummarization: (): void => undefined }

const seedSpec = (repo: string, changeName: string, mtime: number, done = false): void => {
  const files = done
    ? [
        { path: `a/${changeName}/proposal.md`, kind: 'proposal', hash: 'h1', mtime, text: `# ${changeName}\n\nbody` },
        { path: `a/${changeName}/tasks.md`, kind: 'tasks', hash: 'h2', mtime, text: '- [x] one\n- [x] two\n' },
      ]
    : [{ path: `a/${changeName}/proposal.md`, kind: 'proposal', hash: 'h1', mtime, text: `# ${changeName}\n\nbody` }]
  applyPush(CONFIG_CTX, { repo, changeName, files, deletions: [] }, noEnqueue)
}

const presetSummary = (specId: string, oneLine: string, summary: string): void => {
  getDrizzleDb()
    .update(contextVaultSpecs)
    .set({ oneLine, summary })
    .where(and(eq(contextVaultSpecs.configContextId, CONFIG_CTX), eq(contextVaultSpecs.id, specId)))
    .run()
}

describe('context-vault facade', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('list returns the specs stored at the config context with freshness meta', () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('papai', 'beta', 200, true)

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    const result = facade.list()

    expect(result.specs).toEqual([
      { id: 'papai:alpha', repo: 'papai', name: 'alpha', oneLine: '', stage: 'draft', progressPct: 0, mtime: 100 },
      { id: 'papai:beta', repo: 'papai', name: 'beta', oneLine: '', stage: 'done', progressPct: 100, mtime: 200 },
    ])
    expect(typeof result.meta.lastPushAt).toBe('number')
  })

  test('list returns empty specs and null lastPushAt when nothing was pushed', () => {
    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    expect(facade.list()).toEqual({ specs: [], meta: { lastPushAt: null } })
  })

  test('list resolves the group config context from a thread-scoped storage context and isolates other contexts', () => {
    seedSpec('papai', 'alpha', 100)
    applyPush(
      OTHER_CTX,
      {
        repo: 'papai',
        changeName: 'foreign',
        files: [{ path: 'a/foreign/proposal.md', kind: 'proposal', hash: 'h1', mtime: 1, text: '# F\n' }],
        deletions: [],
      },
      noEnqueue,
    )

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    expect(facade.list().specs.map((s) => s.id)).toEqual(['papai:alpha'])
  })

  test('list filters by repo, status, and changedSince', () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('papai', 'beta', 200, true)
    seedSpec('other', 'gamma', 300)

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)

    expect(facade.list({ repo: 'other' }).specs.map((s) => s.id)).toEqual(['other:gamma'])
    expect(facade.list({ status: 'done' }).specs.map((s) => s.id)).toEqual(['papai:beta'])
    expect(facade.list({ changedSince: 150 }).specs.map((s) => s.id)).toEqual(['papai:beta', 'other:gamma'])
  })

  test('get returns the full read shape for a full repo:change id', () => {
    seedSpec('papai', 'alpha', 100)
    presetSummary('papai:alpha', 'vault one-liner', 'vault summary')

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    const result = facade.get('papai:alpha')

    expect(result).toMatchObject({
      ok: true,
      spec: {
        id: 'papai:alpha',
        repo: 'papai',
        name: 'alpha',
        oneLine: 'vault one-liner',
        summary: 'vault summary',
        outline: ['# alpha'],
        stage: 'draft',
        progressPct: 0,
        mtime: 100,
      },
    })
    z.object({ ok: z.literal(true), meta: z.object({ lastPushAt: z.number() }) }).parse(result)
  })

  test('get resolves a bare change name when it is unique across repos', () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('other', 'gamma', 300)

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    expect(facade.get('gamma')).toMatchObject({ ok: true, spec: { id: 'other:gamma' } })
  })

  test('get returns the candidate full ids when a bare name collides across repos', () => {
    seedSpec('papai', 'alpha', 100)
    seedSpec('other', 'alpha', 300)

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    const result = facade.get('alpha')

    expect(result).toEqual({ ok: false, reason: 'ambiguous', candidates: ['other:alpha', 'papai:alpha'] })
  })

  test('get returns not-found for an unknown id or bare name', () => {
    seedSpec('papai', 'alpha', 100)

    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, true)
    expect(facade.get('papai:missing')).toEqual({ ok: false, reason: 'not-found' })
    expect(facade.get('missing')).toEqual({ ok: false, reason: 'not-found' })
  })

  test('list throws without the contextVault.read permission', () => {
    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, false)
    expect(() => facade.list()).toThrow("does not have 'contextVault.read' permission")
  })

  test('get throws without the contextVault.read permission', () => {
    const facade = buildContextVaultFacade('context-vault', THREAD_CTX, false)
    expect(() => facade.get('papai:alpha')).toThrow("does not have 'contextVault.read' permission")
  })
})
