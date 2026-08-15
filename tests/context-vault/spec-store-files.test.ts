// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { applyFiles, deleteFile, type ApplyPushInput } from '../../src/context-vault/spec-store-files.js'
import { contextVaultFiles, type ContextVaultFileRow } from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'pi:telegram:grp:a'
const SPEC_ID = 'papai:x'

const getFiles = (): ContextVaultFileRow[] =>
  getDrizzleDb()
    .select()
    .from(contextVaultFiles)
    .where(and(eq(contextVaultFiles.configContextId, CTX), eq(contextVaultFiles.specId, SPEC_ID)))
    .all()

const input = (files: ApplyPushInput['files']): ApplyPushInput => ({
  repo: 'papai',
  changeName: 'x',
  files,
  deletions: [],
})

describe('context-vault spec-store-files', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('applyFiles inserts new files and reports them as changed with their text', () => {
    const result = applyFiles(
      CTX,
      SPEC_ID,
      input([{ path: 'a/proposal.md', kind: 'proposal', hash: 'h1', mtime: 1, text: '# P\n' }]),
      new Map(),
    )

    expect(result.changedPaths).toEqual(['a/proposal.md'])
    expect(result.summarizerFiles).toEqual([{ path: 'a/proposal.md', kind: 'proposal', text: '# P\n' }])
    expect(getFiles().map((f) => f.path)).toEqual(['a/proposal.md'])
  })

  test('applyFiles forwards an unchanged file with text to the summarizer without marking it changed', () => {
    const files = [
      { path: 'a/proposal.md', kind: 'proposal', hash: 'h1', mtime: 1, text: '# P\n' },
      { path: 'a/tasks.md', kind: 'tasks', hash: 'h2', mtime: 2, text: '- [ ] one\n' },
    ]
    applyFiles(CTX, SPEC_ID, input(files), new Map())
    const existing = new Map(getFiles().map((f) => [f.path, f]))

    const result = applyFiles(CTX, SPEC_ID, input(files), existing)

    expect(result.changedPaths).toEqual([])
    expect(result.summarizerFiles).toEqual([
      { path: 'a/proposal.md', kind: 'proposal', text: '# P\n' },
      { path: 'a/tasks.md', kind: 'tasks', text: '- [ ] one\n' },
    ])
  })

  test('applyFiles updates a file whose hash changed and leaves an unchanged no-text file out of the summarizer input', () => {
    applyFiles(
      CTX,
      SPEC_ID,
      input([
        { path: 'a/proposal.md', kind: 'proposal', hash: 'h1', mtime: 1, text: '# P\n' },
        { path: 'a/design.md', kind: 'design', hash: 'h9', mtime: 1, text: '# D\n' },
      ]),
      new Map(),
    )
    const existing = new Map(getFiles().map((f) => [f.path, f]))

    const result = applyFiles(
      CTX,
      SPEC_ID,
      input([
        { path: 'a/proposal.md', kind: 'proposal', hash: 'h1-new', mtime: 3, text: '# P v2\n' },
        { path: 'a/design.md', kind: 'design', hash: 'h9', mtime: 1 },
      ]),
      existing,
    )

    expect(result.changedPaths).toEqual(['a/proposal.md'])
    expect(result.summarizerFiles).toEqual([{ path: 'a/proposal.md', kind: 'proposal', text: '# P v2\n' }])
    expect(getFiles().find((f) => f.path === 'a/proposal.md')?.hash).toBe('h1-new')
  })

  test('deleteFile removes only the named row of the spec', () => {
    applyFiles(
      CTX,
      SPEC_ID,
      input([
        { path: 'a/proposal.md', kind: 'proposal', hash: 'h1', mtime: 1, text: '# P\n' },
        { path: 'a/design.md', kind: 'design', hash: 'h2', mtime: 1, text: '# D\n' },
      ]),
      new Map(),
    )

    deleteFile(CTX, SPEC_ID, 'a/design.md')

    expect(getFiles().map((f) => f.path)).toEqual(['a/proposal.md'])
  })
})
