// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { isFrozenEnforcementPath } from '../../scripts/story/inputs.js'
import { STORY_SANDBOX_LINUX_IMAGE } from '../../scripts/story/sandbox.js'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const readRepositoryFile = (relative: string): string => readFileSync(path.join(repositoryRoot, relative), 'utf8')

describe('story sandbox image single source', () => {
  test('the checked-in image file is the exported reference', () => {
    expect(readRepositoryFile('scripts/story/sandbox-image.txt').trim()).toBe(STORY_SANDBOX_LINUX_IMAGE)
  })

  test('the pinned reference carries a sha256 digest and the required Bun tag', () => {
    expect(STORY_SANDBOX_LINUX_IMAGE).toMatch(/^docker\.io\/oven\/bun:1\.3\.13@sha256:[a-f0-9]{64}$/u)
  })

  test('sandbox.ts does not hardcode a digest', () => {
    expect(readRepositoryFile('scripts/story/sandbox.ts')).not.toContain('sha256:')
  })

  test('the image file is a frozen enforcement input', () => {
    expect(isFrozenEnforcementPath('scripts/story/sandbox-image.txt')).toBe(true)
    expect(isFrozenEnforcementPath('scripts/story/other.txt')).toBe(false)
  })

  test.each(['.github/workflows/ci.yml', '.github/workflows/story-stress.yml'])(
    '%s reads the image file instead of hardcoding it',
    (workflow) => {
      const contents = readRepositoryFile(workflow)
      expect(contents).toContain('cat scripts/story/sandbox-image.txt')
      expect(contents).not.toContain('sha256:')
    },
  )

  test('the commands documentation points at the image file instead of hardcoding the digest', () => {
    const contents = readRepositoryFile('docs/architecture/commands.md')
    expect(contents).not.toMatch(/oven\/bun:[^\s`]*@sha256:/u)
    expect(contents).toContain('scripts/story/sandbox-image.txt')
  })
})
