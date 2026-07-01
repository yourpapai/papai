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

const EGRESS_MAX = 20
const EGRESS_HOST_MAXLEN = 253
const isBareHost = (h: string): boolean => /^[a-z0-9._-]+(:[0-9]+)?$/iu.test(h)

function normalizeEgress(domains: string[]): string[] {
  const cleaned = domains.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0)
  return [...new Set(cleaned)]
}

function parseEgress(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function assertValid(input: RepoInput): void {
  if (!/^https:\/\//u.test(input.repoUrl)) throw new Error('repo_url must be https')
  if (!isRepoPreset(input.permissionPreset)) throw new Error('invalid permission preset')
  if (input.name.trim().length === 0) throw new Error('name is required')
  const domains = input.additionalEgressDomains ?? []
  if (domains.length > EGRESS_MAX) throw new Error(`too many egress domains (max ${EGRESS_MAX})`)
  for (const d of domains) {
    if (d.length > EGRESS_HOST_MAXLEN) throw new Error(`egress domain too long: ${d}`)
    if (!isBareHost(d)) throw new Error(`invalid egress domain: ${d}`)
  }
}

const rowToRecord = (r: {
  repoId: string
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  additionalEgressDomains: string
}): RepoRecord => {
  const preset = isRepoPreset(r.permissionPreset) ? r.permissionPreset : 'readonly'
  return {
    repoId: r.repoId,
    name: r.name,
    repoUrl: r.repoUrl,
    baseBranch: r.baseBranch,
    permissionPreset: preset,
    additionalEgressDomains: parseEgress(r.additionalEgressDomains),
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

export function getRepoByName(contextId: string, name: string): RepoRecord | null {
  const r = getDrizzleDb()
    .select()
    .from(codingSessionRepos)
    .where(and(eq(codingSessionRepos.contextId, contextId), eq(codingSessionRepos.name, name)))
    .get()
  return r === undefined ? null : rowToRecord(r)
}

export function upsertRepo(contextId: string, input: RepoInput, updatedBy: string): string {
  const additionalEgressDomains = normalizeEgress(input.additionalEgressDomains ?? [])
  assertValid({ ...input, additionalEgressDomains })
  const egressJson = JSON.stringify(additionalEgressDomains)
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
      additionalEgressDomains: egressJson,
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
        additionalEgressDomains: egressJson,
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
