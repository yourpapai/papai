// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { Glob } from 'bun'

// Feature/provider names that must never appear in feature-agnostic core.
// `\bmagi\b` uses word boundaries so it does not match words like "imaging".
const FEATURE_NAMES = /\b(kaneo|youtrack|magi)\b|plugin_acp__/iu

const scan = async (pattern: string): Promise<string[]> => {
  const glob = new Glob(pattern)
  const offenders: string[] = []
  for await (const file of glob.scan('.')) {
    if (FEATURE_NAMES.test(readFileSync(file, 'utf8'))) offenders.push(file)
  }
  return offenders
}

describe('architecture guard: core never names a feature', () => {
  test('src/ports/** is feature-agnostic', async () => {
    expect(await scan('src/ports/**/*.ts')).toEqual([])
  })

  test('llm-orchestrator-tools.ts no longer enumerates acp tool names', () => {
    const text = readFileSync('src/llm-orchestrator-tools.ts', 'utf8')
    expect(/plugin_acp__|ACP_SESSION_ACTION_TOOLS/u.test(text)).toBe(false)
  })
})
