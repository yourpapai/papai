// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { codingSessionRepos } from '../db/coding-repos-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { REPO_PRESETS, type RepoInput, type RepoPreset, type RepoRecord } from './types.js'

const log = logger.child({ scope: 'coding-repos:store' })

const now = (): number => Date.now()

const isRepoPreset = (value: string): value is RepoPreset => (REPO_PRESETS as readonly string[]).includes(value)

function assertValid(input: RepoInput): void {
  if (!/^https:\/\//u.test(input.repoUrl)) throw new Error('repo_url must be https')
  if (!isRepoPreset(input.permissionPreset)) throw new Error('invalid permission preset')
  if (input.name.trim().length === 0) throw new Error('name is required')
}

const rowToRecord = (r: {
  repoId: string
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
}): RepoRecord => {
  const preset = isRepoPreset(r.permissionPreset) ? r.permissionPreset : 'readonly'
  return {
    repoId: r.repoId,
    name: r.name,
    repoUrl: r.repoUrl,
    baseBranch: r.baseBranch,
    permissionPreset: preset,
  }
}

export function listRepos(contextId: string): RepoRecord[] {
  return getDrizzleDb()
    .select()
    .from(codingSessionRepos)
    .where(eq(codingSessionRepos.contextId, contextId))
    .all()
    .map(rowToRecord)
}

export function upsertRepo(contextId: string, input: RepoInput, updatedBy: string): string {
  assertValid(input)
  // Find the existing repo by name (unique per context) to get its repoId for upsert
  const existing = getDrizzleDb()
    .select()
    .from(codingSessionRepos)
    .where(and(eq(codingSessionRepos.contextId, contextId), eq(codingSessionRepos.name, input.name)))
    .get()
  const repoId = existing?.repoId ?? randomUUID()
  getDrizzleDb()
    .insert(codingSessionRepos)
    .values({
      contextId,
      repoId,
      name: input.name,
      repoUrl: input.repoUrl,
      baseBranch: input.baseBranch,
      permissionPreset: input.permissionPreset,
      updatedAt: now(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [codingSessionRepos.contextId, codingSessionRepos.repoId],
      set: {
        name: input.name,
        repoUrl: input.repoUrl,
        baseBranch: input.baseBranch,
        permissionPreset: input.permissionPreset,
        updatedAt: now(),
        updatedBy,
      },
    })
    .run()
  log.info({ contextId, name: input.name, updatedBy }, 'repo upserted')
  return repoId
}

export function deleteRepo(contextId: string, repoId: string, updatedBy: string): void {
  getDrizzleDb()
    .delete(codingSessionRepos)
    .where(and(eq(codingSessionRepos.contextId, contextId), eq(codingSessionRepos.repoId, repoId)))
    .run()
  log.info({ contextId, repoId, updatedBy }, 'repo deleted')
}
