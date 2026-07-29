// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  resolveStagedFile,
  searchStagedFiles,
  setBlobStoreForTesting,
  stageFileMetadata,
} from '../../../src/attachments/index.js'
import type { StagedFileRef } from '../../../src/attachments/types.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { attachments } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'
import type { ContextHandle } from '../harness/world.js'

const stage = (
  context: ContextHandle,
  contextId: string,
  filename: string,
  platformFileId: string,
  messageId: string,
): StagedFileRef =>
  stageFileMetadata({
    contextId,
    messageId,
    senderId: 'scenario-sender',
    senderUsername: 'scenario-sender',
    filename,
    mimeType: 'text/plain',
    size: 12,
    platformFileId,
    sourceProvider: 'telegram',
    sourcePlatformInstanceId: context.platformInstanceId,
    origin: null,
    forwardedFrom: null,
  })

scenario(
  'SCN-attachments-staged-scope-search: staged search respects thread and group boundaries',
  async ({ given, world }) => {
    const groupA = given.group('group-a')
    const a1 = given.thread(groupA, 'thread-1')
    const a2 = given.thread(groupA, 'thread-2')
    const groupB = given.group('group-b')
    const b1 = given.thread(groupB, 'thread-1')
    const a1Context = world.scopedStorageContextId(a1)
    const b1Context = world.scopedStorageContextId(b1)

    const a1Staged = stage(a1, a1Context, 'alpha-plan.txt', 'telegram-a1-alpha-plan', 'a1-message')
    stage(a2, world.scopedStorageContextId(a2), 'alpha-notes.txt', 'telegram-a2-alpha-notes', 'a2-message')
    stage(b1, b1Context, 'alpha-private.txt', 'telegram-b1-alpha-private', 'b1-message')

    expect(searchStagedFiles(a1Context, 'alpha').map(({ filename }) => filename)).toEqual(['alpha-plan.txt'])
    expect(
      searchStagedFiles(a1Context, 'alpha', { groupContextId: world.groupScopeId(groupA) })
        .map(({ filename }) => filename)
        .toSorted(),
    ).toEqual(['alpha-notes.txt', 'alpha-plan.txt'])

    let downloads = 0
    const result = await resolveStagedFile(
      a1Staged.stagedId,
      b1Context,
      () => {
        downloads++
        return Promise.resolve(Buffer.from('must-not-download'))
      },
      { groupContextId: world.groupScopeId(groupB) },
    )
    expect(result).toMatchObject({ status: 'not_found' })
    expect(downloads).toBe(0)
    expect(getDrizzleDb().select().from(attachments).all()).toHaveLength(0)
  },
)

scenario(
  'SCN-attachments-staged-resolution: staged resolution is single-use, terminal, and re-sendable',
  async ({ given, world }) => {
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
    try {
      const group = given.group('group-a')
      const thread = given.thread(group, 'thread-1')
      const contextId = world.scopedStorageContextId(thread)
      const staged = stage(thread, contextId, 'retry-me.txt', 'telegram-retry-me', 'first-message')
      let downloads = 0

      const failed = await resolveStagedFile(staged.stagedId, contextId, () => {
        downloads++
        return Promise.resolve(null)
      })
      expect(failed).toMatchObject({ status: 'download_failed' })

      const terminal = await resolveStagedFile(staged.stagedId, contextId, () => {
        downloads++
        return Promise.resolve(Buffer.from('must-not-download'))
      })
      expect(terminal).toMatchObject({ status: 'download_failed' })
      expect(downloads).toBe(1)
      expect(getDrizzleDb().select().from(attachments).all()).toHaveLength(0)

      const restaged = stage(thread, contextId, 'retry-me.txt', 'telegram-retry-me', 'second-message')
      expect(restaged).toMatchObject({ stagedId: staged.stagedId, status: 'staged' })

      const resolved = await resolveStagedFile(restaged.stagedId, contextId, () =>
        Promise.resolve(Buffer.from('fixed-bytes')),
      )
      expect(resolved).toMatchObject({ status: 'available' })
      if (!('attachmentId' in resolved)) throw new Error('Expected the re-staged file to resolve to an attachment')
      const attachmentId = resolved.attachmentId

      const alreadyResolved = await resolveStagedFile(restaged.stagedId, contextId, () =>
        Promise.resolve(Buffer.from('unused')),
      )
      expect(alreadyResolved).toMatchObject({ status: 'already_resolved', attachmentId })
      expect(
        getDrizzleDb().select().from(attachments).where(eq(attachments.attachmentId, attachmentId)).all(),
      ).toHaveLength(1)
    } finally {
      resetBlobStoreForTesting()
    }
  },
)
