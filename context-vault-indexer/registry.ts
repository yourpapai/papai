// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { writeConfig, type ConfigFs, type IndexerConfig, type RepoEntry } from './config.js'
import { resolveRepoIdentity, type IdentityFs } from './repo-identity.js'

export type RegistryDeps = {
  stateDir: string
  configFs: ConfigFs
  identityFs: IdentityFs
  dirExists(path: string): boolean
}

export type RegisterAction = 'registered' | 'updated' | 'unchanged'

export type RegisterResult = { ok: true; repo: string; action: RegisterAction } | { ok: false; error: string }

export type RepoRuntimeEntry = RepoEntry & {
  /** Canonical repo root: what the entry is keyed by, worktrees collapsed. */
  identity: string
  /** Stable per-repo suffix for the scan-state file; derived from identity. */
  stateKey: string
}

export type RepoRegistry = {
  list(): RepoEntry[]
  runtimes(): RepoRuntimeEntry[]
  register(input: RepoEntry): RegisterResult
  markScan(at: number): void
  lastScanAt(): number | null
}

const stateKeyOf = (identity: string): string => createHash('sha256').update(identity).digest('hex').slice(0, 16)

/**
 * The daemon's repo set, keyed by canonical repository identity so several
 * worktrees of one project stay one entry. Registering a different worktree of
 * a known repository re-points its active spec dir rather than adding a second
 * entry: the freshly activated session is the one being worked in, and because
 * the state key follows the identity rather than the path, the re-point diffs
 * against the same ledger instead of re-pushing every file as new.
 *
 * Mutations persist to the config file immediately, so a restart resumes
 * without a fresh registration.
 */
export function createRepoRegistry(config: IndexerConfig, deps: RegistryDeps): RepoRegistry {
  const entries = new Map<string, RepoRuntimeEntry>()
  let lastScan: number | null = null

  const put = (entry: RepoEntry): RegisterAction => {
    const { identity } = resolveRepoIdentity(entry.specDir, deps.identityFs)
    const existing = entries.get(identity)
    const next: RepoRuntimeEntry = { ...entry, identity, stateKey: stateKeyOf(identity) }
    entries.set(identity, next)
    if (existing === undefined) return 'registered'
    return existing.specDir === entry.specDir && existing.repo === entry.repo ? 'unchanged' : 'updated'
  }

  for (const entry of config.repos) put(entry)

  const list = (): RepoEntry[] => [...entries.values()].map((entry) => ({ repo: entry.repo, specDir: entry.specDir }))

  const persist = (): void => {
    writeConfig(deps.stateDir, { ...config, repos: list() }, deps.configFs)
  }

  return {
    list,
    runtimes: () => [...entries.values()],
    register: (input: RepoEntry): RegisterResult => {
      if (!deps.dirExists(input.specDir)) {
        return { ok: false, error: `Spec directory does not exist: ${input.specDir}` }
      }
      const action = put(input)
      if (action !== 'unchanged') persist()
      return { ok: true, repo: input.repo, action }
    },
    markScan: (at: number) => {
      lastScan = at
    },
    lastScanAt: () => lastScan,
  }
}
