// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { resetGrepCache } from '../../../scripts/behavior-audit/tools.js'

const FIXTURE_ROOT = join(import.meta.dir, 'fixtures/grep-sample')

async function callGrepTool(pattern: string, directory?: string): Promise<string> {
  const mod = await import('../../../scripts/behavior-audit/tools.js')
  const tools = mod.makeAuditToolsForRoot(FIXTURE_ROOT)
  return tools.grep.execute({ pattern, directory })
}

describe('grep tool (pure JS)', () => {
  afterEach(() => {
    resetGrepCache()
  })

  test('finds matches across .ts files in src and tests', async () => {
    const result = await callGrepTool('startBot')
    expect(result).toContain('src/bot.ts:2')
    expect(result).toContain('tests/bot.test.ts:3')
  })

  test('respects directory filter', async () => {
    const result = await callGrepTool('startBot', 'src')
    expect(result).toContain('src/bot.ts')
    expect(result).not.toContain('tests/')
  })

  test('respects directory filter on tests/', async () => {
    const result = await callGrepTool('starts', 'tests')
    expect(result).toContain('tests/bot.test.ts')
    expect(result).not.toContain('src/bot.ts')
  })

  test('returns "No matches found" when nothing matches', async () => {
    const result = await callGrepTool('this-pattern-will-never-match-anything')
    expect(result).toBe('No matches found')
  })

  test('returns error string on invalid regex', async () => {
    const result = await callGrepTool('([')
    expect(result).toContain('Error: invalid regex')
  })

  test('returns "Error enumerating files" when directory does not exist', async () => {
    const result = await callGrepTool('foo', 'this-directory-does-not-exist-xyz')
    expect(result.startsWith('Error enumerating files:')).toBe(true)
  })

  test('returns error string on directory outside project', async () => {
    const result = await callGrepTool('foo', '../outside')
    expect(result).toContain('resolves outside project')
  })

  test('caps at 100 matches', async () => {
    const result = await callGrepTool('.')
    const lines = result.split('\n')
    expect(lines.length).toBeLessThanOrEqual(100)
  })

  test('second call hits cache (returns same results)', async () => {
    const first = await callGrepTool('startBot')
    const second = await callGrepTool('startBot')
    expect(second).toBe(first)
  })
})
