// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  ALLOWLISTS,
  analysisAllowlist,
  MAX_ARG_STRLEN,
  modelIdForCli,
  profileBlock,
  allowlistForLabel,
} from '../../review-loop/src/claude-argv.js'

describe('MAX_ARG_STRLEN', () => {
  test('is the Linux single-argument cap, 131072 bytes', () => {
    expect(MAX_ARG_STRLEN).toBe(131_072)
  })
})

describe('profileBlock', () => {
  test('the bare profile carries --bare', () => {
    expect(profileBlock('bare', null)).toEqual(['--bare'])
  })

  test('the native profile carries the neutralization pair, both mandatory on every invocation', () => {
    expect(profileBlock('native', '/tmp/cfg/mcp.json')).toEqual([
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '/tmp/cfg/mcp.json',
    ])
  })

  test('a native invocation with no MCP document path is a named refusal', () => {
    expect(() => profileBlock('native', null)).toThrow(/mcp-config/u)
  })
})

describe('allowlists', () => {
  test('the fixer set is closed and includes edit plus execute', () => {
    expect(ALLOWLISTS.fixer).toBe('Read,Edit,Write,Bash,Glob,Grep')
  })

  test('the analysis base set mirrors the parent plan set verbatim', () => {
    expect(ALLOWLISTS.analysis).toBe('Read,Glob,Grep')
  })

  test('the analysis set scopes Write to the scratch dir as an absolute rule composed from the spawn cwd', () => {
    expect(analysisAllowlist('/repo/.review-loop/worktrees/42')).toBe(
      'Read,Glob,Grep,Write(/repo/.review-loop/worktrees/42/.review-loop/**)',
    )
  })

  test('no allowlist carries a wildcard tool entry', () => {
    for (const entry of [...ALLOWLISTS.fixer.split(','), ...ALLOWLISTS.analysis.split(',')]) {
      expect(entry.includes('*')).toBe(false)
    }
  })
})

describe('allowlistForLabel', () => {
  const cwd = '/repo/.review-loop/worktrees/42'
  const analysis = analysisAllowlist(cwd)

  test('the documented label forms map across every role', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['reviewer', analysis],
      ['matcher', analysis],
      ['inspector', analysis],
      ['inspector-w1', analysis],
      ['inspector-w12', analysis],
      ['inspector-aggregated', analysis],
      ['fixer', ALLOWLISTS.fixer],
      ['fixer-w1', ALLOWLISTS.fixer],
      ['fixer-w2-retry', ALLOWLISTS.fixer],
      ['fixer-batch-cluster-7', ALLOWLISTS.fixer],
    ]
    for (const [label, expected] of cases) {
      expect(allowlistForLabel(label, cwd)).toBe(expected)
    }
  })

  test('an unrecognized label falls to the analysis (weakest) set with the condition logged', () => {
    const warnings: string[] = []
    const allowlist = allowlistForLabel('auditor', cwd, (message) => {
      warnings.push(message)
    })
    expect(allowlist).toBe(analysis)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('auditor')
  })

  test('a recognized label logs nothing', () => {
    const warnings: string[] = []
    allowlistForLabel('fixer-w1', cwd, (message) => {
      warnings.push(message)
    })
    expect(warnings).toHaveLength(0)
  })
})

describe('allowlistForLabel — the sdd-runner role labels', () => {
  const cwd = '/repo/.sdd-runner/run-7'
  const analysis = analysisAllowlist(cwd)
  /**
   * The artifact-writing set spelled out rather than read off `ALLOWLISTS`:
   * this pins the doctrine value itself, and the constant it must equal is
   * pinned separately against the parent route's `propose` set.
   */
  const authoring = 'Read,Edit,Write,Glob,Grep'

  const artifactWriters = [
    'drafter-proposal',
    'drafter-specs',
    'drafter-design',
    'resolver-r1',
    'resolver-r12',
    'decomposer',
    'atomicity',
  ] as const
  const analysts = ['reviewer-r1', 'reviewer-r12', 'skeptic-r1', 'skeptic-r12', 'estimator', 'planner'] as const

  test('the artifact-writing roles resolve to the authoring set', () => {
    for (const label of artifactWriters) {
      expect(allowlistForLabel(label, cwd)).toBe(authoring)
    }
  })

  test('the analysis roles resolve to the analysis set, scratch Write rule included', () => {
    for (const label of analysts) {
      expect(allowlistForLabel(label, cwd)).toBe(analysis)
    }
    expect(analysis).toBe(`Read,Glob,Grep,Write(${cwd}/.review-loop/**)`)
  })

  test('no runner label logs the unmapped-label warning', () => {
    const warnings: string[] = []
    for (const label of [...artifactWriters, ...analysts]) {
      allowlistForLabel(label, cwd, (message) => {
        warnings.push(message)
      })
    }
    expect(warnings).toEqual([])
  })

  test('no runner label grants Bash or a bare wildcard tool entry', () => {
    for (const label of [...artifactWriters, ...analysts]) {
      const entries = allowlistForLabel(label, cwd).split(',')
      expect(entries).not.toContain('Bash')
      // A scoped rule carries its glob inside the parens; the bare tool entries carry none.
      const bare = entries.filter((entry) => !entry.includes('('))
      expect(bare.some((entry) => entry.includes('*'))).toBe(false)
    }
  })

  test("the loop's own labels keep byte-identical answers", () => {
    for (const label of ['fixer', 'fixer-w1', 'fixer-w2-retry', 'fixer-batch-cluster-7']) {
      expect(allowlistForLabel(label, cwd)).toBe(ALLOWLISTS.fixer)
    }
    for (const label of ['matcher', 'matcher-w1', 'inspector', 'inspector-w1', 'inspector-aggregated']) {
      expect(allowlistForLabel(label, cwd)).toBe(analysis)
    }
  })
})

describe('modelIdForCli', () => {
  test('a slash-bearing value keeps its model id (the opencode provider/model form)', () => {
    expect(modelIdForCli('opencode/claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(modelIdForCli('ollama-cloud/kimi-k2.6:cloud')).toBe('kimi-k2.6:cloud')
  })

  test('a bare model id passes through untouched', () => {
    expect(modelIdForCli('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  test('a model id that itself contains slashes keeps the whole remainder', () => {
    expect(modelIdForCli('provider/sub/model-x')).toBe('sub/model-x')
  })
})
