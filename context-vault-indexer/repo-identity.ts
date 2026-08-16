// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { basename, dirname, normalize } from 'node:path'

/** Bounds the upward walk so a pathological path cannot spin. */
const MAX_WALK_DEPTH = 40

const WORKTREES_SEGMENT = '/worktrees/'

export type IdentityFs = {
  statKind(path: string): 'file' | 'dir' | null
  readFile(path: string): string | null
}

export type RepoIdentity = {
  /** Canonical repo root path; the key every per-repo artifact hangs off. */
  identity: string
  /** Default display name — the caller's explicit repo name wins over this. */
  name: string
}

const stripTrailingSlash = (path: string): string => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path)

/**
 * Resolves the repo root a `.git` **file** points at. Git writes
 * `gitdir: <path>`; for a worktree that path ends in `<main>/.git/worktrees/<name>`,
 * so the main repo root is the parent of the `.git` prefix. Any other gitdir
 * form (a submodule, for example) is not a worktree, and the directory holding
 * the pointer is its own root.
 */
const rootFromGitFile = (gitFilePath: string, contents: string): string | null => {
  const match = /^\s*gitdir:\s*(?<dir>.+?)\s*$/mu.exec(contents)
  const gitDir = match?.groups?.['dir']
  if (gitDir === undefined) return null
  const worktreesAt = gitDir.indexOf(WORKTREES_SEGMENT)
  if (worktreesAt < 0) return dirname(gitFilePath)
  return dirname(normalize(gitDir.slice(0, worktreesAt)))
}

/**
 * Maps a spec directory to the repository that owns it, collapsing git
 * worktrees onto their main repository so N worktrees of one project stay one
 * vault entry. Reads the filesystem only — never shells out to `git`, because
 * the daemon is spawned detached with no dependable PATH.
 *
 * Falls back to the spec directory itself when no `.git` is found or the
 * pointer is malformed, so an OpenSpec tree outside a repository still indexes.
 */
export function resolveRepoIdentity(specDir: string, fs: IdentityFs): RepoIdentity {
  const start = stripTrailingSlash(normalize(specDir))
  let current = start
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    const gitPath = `${current}/.git`
    const kind = fs.statKind(gitPath)
    if (kind === 'dir') return identityOf(current)
    if (kind === 'file') {
      const contents = fs.readFile(gitPath)
      const root = contents === null ? null : rootFromGitFile(gitPath, contents)
      return identityOf(root ?? start)
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return identityOf(start)
}

const identityOf = (identity: string): RepoIdentity => ({ identity, name: basename(identity) })
