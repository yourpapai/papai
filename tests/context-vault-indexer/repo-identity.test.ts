// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { resolveRepoIdentity, type IdentityFs } from '../../context-vault-indexer/repo-identity.js'

type Tree = Record<string, 'dir' | { file: string }>

const makeFs = (tree: Tree): IdentityFs & { reads: string[] } => {
  const reads: string[] = []
  return {
    reads,
    statKind: (path: string) => {
      reads.push(path)
      const entry = tree[path]
      if (entry === undefined) return null
      return entry === 'dir' ? 'dir' : 'file'
    },
    readFile: (path: string) => {
      const entry = tree[path]
      return entry === undefined || entry === 'dir' ? null : entry.file
    },
  }
}

describe('resolveRepoIdentity', () => {
  test('a .git directory resolves to its parent as the repo root', () => {
    const fs = makeFs({ '/home/u/papai/.git': 'dir' })

    const result = resolveRepoIdentity('/home/u/papai/openspec/changes', fs)

    expect(result.identity).toBe('/home/u/papai')
    expect(result.name).toBe('papai')
  })

  test('resolves from the repo root itself, not only from a nested spec dir', () => {
    const fs = makeFs({ '/home/u/papai/.git': 'dir' })

    expect(resolveRepoIdentity('/home/u/papai', fs).identity).toBe('/home/u/papai')
  })

  test('a worktree .git file resolves to the main repo root', () => {
    const fs = makeFs({
      '/home/u/wt-feature/.git': { file: 'gitdir: /home/u/papai/.git/worktrees/wt-feature\n' },
    })

    const result = resolveRepoIdentity('/home/u/wt-feature/openspec/changes', fs)

    expect(result.identity).toBe('/home/u/papai')
    expect(result.name).toBe('papai')
  })

  test('two worktrees of one repo collapse to a single identity', () => {
    const fs = makeFs({
      '/home/u/wt-a/.git': { file: 'gitdir: /home/u/papai/.git/worktrees/wt-a' },
      '/home/u/wt-b/.git': { file: 'gitdir: /home/u/papai/.git/worktrees/wt-b' },
    })

    const a = resolveRepoIdentity('/home/u/wt-a/openspec/changes', fs)
    const b = resolveRepoIdentity('/home/u/wt-b/openspec/changes', fs)

    expect(a.identity).toBe(b.identity)
    expect(a.identity).toBe('/home/u/papai')
  })

  test('distinct repositories keep distinct identities', () => {
    const fs = makeFs({ '/home/u/papai/.git': 'dir', '/home/u/other/.git': 'dir' })

    expect(resolveRepoIdentity('/home/u/papai/openspec/changes', fs).identity).not.toBe(
      resolveRepoIdentity('/home/u/other/openspec/changes', fs).identity,
    )
  })

  test('a non-worktree gitdir file resolves to the directory owning that git dir', () => {
    const fs = makeFs({
      '/home/u/repo/sub/.git': { file: 'gitdir: /home/u/repo/.git/modules/sub' },
    })

    const result = resolveRepoIdentity('/home/u/repo/sub/openspec/changes', fs)

    expect(result.identity).toBe('/home/u/repo/sub')
  })

  test('falls back to the spec dir when no .git is found', () => {
    const fs = makeFs({})

    const result = resolveRepoIdentity('/tmp/loose/openspec/changes', fs)

    expect(result.identity).toBe('/tmp/loose/openspec/changes')
    expect(result.name).toBe('changes')
  })

  test('a malformed .git file falls back instead of throwing', () => {
    const fs = makeFs({ '/home/u/broken/.git': { file: 'not a gitdir pointer' } })

    expect(resolveRepoIdentity('/home/u/broken/openspec/changes', fs).identity).toBe('/home/u/broken/openspec/changes')
  })

  test('the upward walk is bounded and terminates at the filesystem root', () => {
    const fs = makeFs({})

    const result = resolveRepoIdentity('/a/b/c/d/e/f/g/h', fs)

    expect(result.identity).toBe('/a/b/c/d/e/f/g/h')
    expect(fs.reads.length).toBeLessThan(64)
  })

  test('trailing slashes do not produce a distinct identity', () => {
    const fs = makeFs({ '/home/u/papai/.git': 'dir' })

    expect(resolveRepoIdentity('/home/u/papai/openspec/changes/', fs).identity).toBe(
      resolveRepoIdentity('/home/u/papai/openspec/changes', fs).identity,
    )
  })
})
