// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ALLOWLISTS, buildClaudeArgv, MAX_ARG_STRLEN } from '../../opencode-agent/src/claude-argv.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import { buildAgentCommand } from '../../review-loop/src/agent-command.js'
import {
  ALLOWLISTS as LOOP_ALLOWLISTS,
  analysisAllowlist,
  MAX_ARG_STRLEN as LOOP_MAX_ARG_STRLEN,
} from '../../review-loop/src/claude-argv.js'

/**
 * Two workspaces, one claude-CLI doctrine. `review-loop` duplicates the argv
 * constants rather than importing them — the subprocess boundary the
 * `MINIMALITY_RULE` pin (this directory's `minimality-rule.test.ts`) already
 * defends — and this file is where that duplication is made safe: drift in
 * either workspace fails here.
 *
 * The child-env doctrine is deliberately **not** pinned: review-loop's strip
 * list is a recorded superset of the parent route's (the standalone-laptop
 * scenario closes more names), so env composition diverges by design.
 */

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const STREAMING_TAIL = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default'] as const

/** The contiguous streaming tail inside a composed argv, as a comparable array. */
function tailOf(argv: readonly string[]): readonly string[] {
  const start = argv.indexOf('-p')
  expect(start).toBeGreaterThan(-1)
  return argv.slice(start, start + STREAMING_TAIL.length)
}

describe('the claude argv doctrine has one definition across the workspaces', () => {
  test('MAX_ARG_STRLEN is equal', () => {
    expect(LOOP_MAX_ARG_STRLEN).toBe(MAX_ARG_STRLEN)
  })

  test('the fixer allowlist string is equal to the parent build set', () => {
    expect(LOOP_ALLOWLISTS.fixer).toBe(ALLOWLISTS.build)
  })

  test('the analysis set is the parent plan set plus the scoped Write', () => {
    const cwd = '/repo/.review-loop/worktrees/1'
    const analysis = analysisAllowlist(cwd)
    // ⊇ the parent's plan set...
    for (const tool of ALLOWLISTS.plan.split(',')) {
      expect(analysis.split(',')).toContain(tool)
    }
    // ...plus the cwd-composed absolute scoped-Write rule.
    expect(analysis.split(',')).toContain(`Write(${cwd}/.review-loop/**)`)
    // And the base string itself mirrors the plan set verbatim.
    expect(LOOP_ALLOWLISTS.analysis).toBe(ALLOWLISTS.plan)
  })

  test('the streaming argv tail equals buildClaudeArgv composition', () => {
    const parent = buildClaudeArgv(
      { prompt: 'p' },
      { model: 'm', lightModel: null, planEffort: null, buildEffort: null },
      silentLogger,
    )

    const loop = buildAgentCommand({
      backend: 'claude',
      model: 'm',
      cwd: '/repo/.review-loop/worktrees/1',
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
      claude: {
        profile: 'bare',
        credentialName: 'ANTHROPIC_API_KEY',
        credentialValue: 'sk-ant-secret-0123456789',
        configDir: '/tmp/review-loop-claude-run/spawn-1',
        mcpConfigPath: null,
        envSource: {},
      },
    })

    // The full-event stream `--verbose` yields in print mode is what the loop's
    // decoder inputs exist on: a composition that drops it would still pass an
    // allowlist-only pin while degrading the route to result-only lines.
    expect(tailOf(loop.args)).toEqual([...tailOf(parent.argv)])
    expect(tailOf(loop.args)).toEqual([...STREAMING_TAIL])
  })
})
