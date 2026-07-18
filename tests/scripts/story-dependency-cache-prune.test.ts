// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { pruneDependencyCacheEntries, resolveDependencyCacheKeep } from '../../scripts/story/dependencies.js'

const key = (letter: string): string => letter.repeat(64)

async function createEntry(root: string, name: string, mtime: Date): Promise<void> {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'manifest.json'), '{}\n')
  await utimes(directory, mtime, mtime)
}

describe('resolveDependencyCacheKeep', () => {
  test('defaults to three and accepts positive integers', () => {
    expect(resolveDependencyCacheKeep({})).toBe(3)
    expect(resolveDependencyCacheKeep({ PAPAI_STORY_DEPENDENCY_CACHE_KEEP: '5' })).toBe(5)
    expect(resolveDependencyCacheKeep({ PAPAI_STORY_DEPENDENCY_CACHE_KEEP: ' 4 ' })).toBe(4)
  })

  test('rejects blank, zero, negative, and non-numeric values', () => {
    for (const value of ['', '0', '-2', 'abc', '2.5']) {
      expect(resolveDependencyCacheKeep({ PAPAI_STORY_DEPENDENCY_CACHE_KEEP: value })).toBe(3)
    }
  })
})

describe('pruneDependencyCacheEntries', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'papai-cache-prune-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('keeps the newest entries and always keeps the current key', async () => {
    const names = ['a', 'b', 'c', 'd', 'e'].map(key)
    const base = Date.parse('2026-07-19T00:00:00Z')
    for (const [index, name] of names.entries()) {
      await createEntry(root, name, new Date(base + index * 1000))
    }

    await pruneDependencyCacheEntries(root, names[0]!, {}, 2)

    expect((await readdir(root)).sort()).toEqual([names[0]!, names[3]!, names[4]!].sort())
  })

  test('does nothing at or below the keep limit', async () => {
    const names = ['a', 'b'].map(key)
    for (const name of names) await createEntry(root, name, new Date('2026-07-19T00:00:00Z'))

    await pruneDependencyCacheEntries(root, names[0]!, {}, 3)

    expect((await readdir(root)).sort()).toEqual(names.sort())
  })

  test('ignores staging directories and non-hash entries', async () => {
    const names = ['a', 'b', 'c', 'd'].map(key)
    const base = Date.parse('2026-07-19T00:00:00Z')
    for (const [index, name] of names.entries()) {
      await createEntry(root, name, new Date(base + index * 1000))
    }
    await createEntry(root, '.staging-tmp', new Date('2026-07-18T00:00:00Z'))

    await pruneDependencyCacheEntries(root, names[3]!, {}, 2)

    expect((await readdir(root)).sort()).toEqual(['.staging-tmp', names[2]!, names[3]!].sort())
  })
})
