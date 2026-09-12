// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(import.meta.dir, '..', '..', '..', 'stryker.config.json')

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const config: Record<string, unknown> = (() => {
  const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  if (!isJsonObject(parsed)) throw new Error('Expected stryker.config.json to contain a JSON object')
  return parsed
})()

// Array-ness and string entries are pinned at module scope (no-conditional-in-test):
// the test bodies stay straight-line expects against a typed glob list.
const mutateGlobs: readonly string[] = (() => {
  const mutate = config['mutate']
  if (!Array.isArray(mutate)) throw new Error('Expected stryker.config.json mutate to be an array')
  return mutate.filter((entry): entry is string => typeof entry === 'string')
})()

describe('stryker.config.json', () => {
  test('keeps disableTypeChecks false so the sandbox leaves non-target source bytes untouched', () => {
    expect(config['disableTypeChecks']).toBe(false)
  })

  test('pins the tsconfig sentinel that disables the sandbox tsconfig rewrite', () => {
    // The value is a file that deliberately does not exist: Stryker's sandbox
    // preprocessor skips the rewrite when the configured tsconfig is absent
    // from the sandbox file set, and the rewrite itself calls the TypeScript
    // 6-only `parseConfigFileTextToJson`, which aborts every run under
    // TypeScript 7. See scripts/mutation/README.md, "tsconfigFile points at a
    // file that does not exist — on purpose". If this pin fails, either the
    // sentinel was changed or someone "fixed" it by creating the file —
    // re-read that section before touching either.
    expect(config['tsconfigFile']).toBe('tsconfig.stryker-rewrite-disabled.json')
    expect(existsSync(path.join(path.dirname(CONFIG_PATH), 'tsconfig.stryker-rewrite-disabled.json'))).toBe(false)
  })

  test('widens the mutate scope to the coding-agent workspace with the per-tree exclusion pattern', () => {
    // D1 of the mutation-gate-widening change: the workspace joins the mutate
    // globs with the same shape as every other gated tree — positive glob plus
    // tree-scoped `!**/index.ts` and `!**/constants.ts` exclusions — so the
    // globs (full-scope runs) and the gateable predicate (changed runs) keep
    // answering identically to "what product code is measured".
    expect(mutateGlobs).toContain('opencode-agent/src/**/*.ts')
    expect(mutateGlobs).toContain('!opencode-agent/src/**/index.ts')
    expect(mutateGlobs).toContain('!opencode-agent/src/**/constants.ts')
  })
})
