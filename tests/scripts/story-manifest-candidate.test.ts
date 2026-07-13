// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadCandidateStoryFiles } from '../../scripts/story-manifest-candidate.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('candidate story capture', () => {
  test('rejects a story directory replaced by a symlink after enumeration', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-directory-race-'))
    roots.push(root)
    const stories = path.join(root, 'tests/stories')
    const moved = path.join(root, 'tests/original-stories')
    const external = path.join(root, 'external')
    mkdirSync(stories, { recursive: true })
    mkdirSync(external)
    mkdirSync(path.join(root, 'scripts'))
    writeFileSync(path.join(stories, 'example.story.test.ts'), 'captured')
    writeFileSync(path.join(external, 'example.story.test.ts'), 'attacker')
    const actions = new Map<string, () => void>([
      [
        stories,
        (): void => {
          renameSync(stories, moved)
          symlinkSync(external, stories)
        },
      ],
    ])

    await expect(
      loadCandidateStoryFiles(root, {
        afterDirectoryRead: (directory) => {
          actions.get(directory)?.()
          actions.delete(directory)
          return Promise.resolve()
        },
      }),
    ).rejects.toThrow('Story manifest directory changed during capture: tests/stories')
  })
})
