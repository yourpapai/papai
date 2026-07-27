// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isCapturedStoryInputPath, isFrozenCoverageSupportPath } from '../../scripts/story/inputs.js'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const enforcementDirectory = 'scripts/story'

const enforcementFiles = readdirSync(path.join(repositoryRoot, enforcementDirectory))
  .filter((entry) => entry.endsWith('.ts'))
  .sort()

const RELATIVE_IMPORT = /(?:from|import)\s+'(\.[^']+)'/gu

function relativeImports(file: string): readonly string[] {
  const contents = readFileSync(path.join(repositoryRoot, enforcementDirectory, file), 'utf8')
  return [...contents.matchAll(RELATIVE_IMPORT)].map((match) => {
    const specifier = match[1] ?? ''
    const resolved = path.posix.join(enforcementDirectory, specifier)
    return resolved.endsWith('.js') ? `${resolved.slice(0, -'.js'.length)}.ts` : resolved
  })
}

describe('story enforcement snapshot self-containment', () => {
  test('the enforcement directory is not empty', () => {
    expect(enforcementFiles.length).toBeGreaterThan(0)
  })

  test.each(enforcementFiles)('%s only imports files the story snapshot captures', (file) => {
    const escaping = relativeImports(file).filter((target) => !isCapturedStoryInputPath(target))

    expect(escaping).toEqual([])
  })

  test('the coverage modules the runner imports are frozen inputs', () => {
    expect(isFrozenCoverageSupportPath('scripts/coverage/normalize-lcov.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/story-coverage-gate.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/ratchet-lib.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/story-scope.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/ratchet.ts')).toBe(false)
  })
})
