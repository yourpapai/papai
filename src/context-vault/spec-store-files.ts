// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { contextVaultFiles, type ContextVaultFileRow } from '../db/context-vault-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { reduceFileText, type ReducedFileArtifacts } from './reducer.js'
import type { SummarizerFileInput } from './summarizer.js'

export interface PushFileInput {
  path: string
  kind: string
  hash: string
  mtime: number
  text?: string
}

export interface ApplyPushInput {
  repo: string
  changeName: string
  files: PushFileInput[]
  deletions: string[]
}

interface StoredArtifacts {
  outline: string | null
  tasksTicked: number | null
  tasksTotal: number | null
}

const artifactsOf = (file: PushFileInput): StoredArtifacts => {
  if (file.text === undefined) return { outline: null, tasksTicked: null, tasksTotal: null }
  const reduced: ReducedFileArtifacts = reduceFileText(file.kind, file.text)
  return { outline: JSON.stringify(reduced.outline), tasksTicked: reduced.ticked, tasksTotal: reduced.total }
}

const applyFile = (configContextId: string, specId: string, file: PushFileInput, exists: boolean): void => {
  const artifacts = artifactsOf(file)
  if (!exists) {
    getDrizzleDb()
      .insert(contextVaultFiles)
      .values({
        configContextId,
        specId,
        path: file.path,
        kind: file.kind,
        hash: file.hash,
        mtime: file.mtime,
        ...artifacts,
      })
      .run()
    return
  }
  getDrizzleDb()
    .update(contextVaultFiles)
    .set({ kind: file.kind, hash: file.hash, mtime: file.mtime, ...(file.text === undefined ? {} : artifacts) })
    .where(
      and(
        eq(contextVaultFiles.configContextId, configContextId),
        eq(contextVaultFiles.specId, specId),
        eq(contextVaultFiles.path, file.path),
      ),
    )
    .run()
}

export const deleteFile = (configContextId: string, specId: string, path: string): void => {
  getDrizzleDb()
    .delete(contextVaultFiles)
    .where(
      and(
        eq(contextVaultFiles.configContextId, configContextId),
        eq(contextVaultFiles.specId, specId),
        eq(contextVaultFiles.path, path),
      ),
    )
    .run()
}

export interface AppliedFiles {
  changedPaths: string[]
  summarizerFiles: SummarizerFileInput[]
}

export const applyFiles = (
  configContextId: string,
  specId: string,
  input: ApplyPushInput,
  existingByPath: ReadonlyMap<string, ContextVaultFileRow>,
): AppliedFiles => {
  const changedPaths: string[] = []
  const summarizerFiles: SummarizerFileInput[] = []
  for (const file of input.files) {
    const existing = existingByPath.get(file.path)
    if (existing !== undefined && existing.hash === file.hash) {
      if (file.text !== undefined) summarizerFiles.push({ path: file.path, kind: file.kind, text: file.text })
      continue
    }
    applyFile(configContextId, specId, file, existing !== undefined)
    changedPaths.push(file.path)
    summarizerFiles.push({ path: file.path, kind: file.kind, text: file.text })
  }
  return { changedPaths, summarizerFiles }
}
