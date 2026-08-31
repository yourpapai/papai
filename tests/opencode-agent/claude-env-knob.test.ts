// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { STRIPPED_NAMES } from '../../opencode-agent/src/claude-connect.js'
import { parseClaudeEnv, REFUSED_NAMES } from '../../opencode-agent/src/claude-env-knob.js'
import { ConfigError } from '../../opencode-agent/src/config-values.js'

/**
 * `AGENT_CLAUDE_ENV` — the claude route's custom child-environment knob, the
 * third non-scalar one: a JSON object mapping environment-variable names to
 * string values, parsed and refused at job start on **both** backends, because
 * an operator flipping `AGENT_BACKEND` later must not inherit a document that
 * was never validated (design D1 — parse always, apply on the claude route
 * only).
 *
 * The refusal that names a **rule** rather than a schema path is the one this
 * suite exists to pin: a name the claude route strips from or injects into the
 * child environment itself is not operator-settable — the entry could never
 * reach the child, and a silently ignored one reads as accepted. The refused
 * set is pinned against `STRIPPED_NAMES` in `claude-connect.ts` twice over, by
 * set membership and by behaviour, so drift in either list fails here the day
 * it happens.
 */
describe('parseClaudeEnv', () => {
  test('an unset or blank knob is no custom environment, not an error', () => {
    // The ordinary case: most repositories declare none, and the run must load
    // exactly as it did before the knob existed.
    expect(parseClaudeEnv(undefined)).toBeUndefined()
    expect(parseClaudeEnv('   ')).toBeUndefined()
  })

  test('accepts a valid object of unowned variable names', () => {
    const env = parseClaudeEnv(
      '{"CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING":"1","CLAUDE_CODE_SUBAGENT_MODEL":"claude-haiku-4-5"}',
    )

    expect(env).toEqual({
      CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-4-5',
    })
  })

  test('accepts an empty-string value', () => {
    // `VAR=` is a legitimate spelling for "explicitly empty", unlike the MCP
    // command rule where a blank word is a command that can never run.
    expect(parseClaudeEnv('{"CLAUDE_CODE_MAX_OUTPUT_TOKENS":""}')).toEqual({ CLAUDE_CODE_MAX_OUTPUT_TOKENS: '' })
  })

  test.each([
    ['not JSON at all', 'not json'],
    ['a JSON array', '["X=1"]'],
    ['a JSON scalar', '"yes"'],
    ['a non-string entry value', '{"X":1}'],
  ])('refuses %s naming the variable', (_case, value) => {
    expect(() => parseClaudeEnv(value)).toThrow(ConfigError)
    expect(() => parseClaudeEnv(value)).toThrow('AGENT_CLAUDE_ENV')
  })

  test.each([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CONFIG_DIR',
    'DISABLE_AUTOUPDATER',
    'LLM_BASE_URL',
    'AGENT_MCP_SERVERS',
    'AGENT_CLAUDE_ENV',
  ])('refuses the route-owned %s, naming the rule', (name) => {
    const knob = JSON.stringify({ [name]: 'x' })

    expect(() => parseClaudeEnv(knob)).toThrow(ConfigError)
    expect(() => parseClaudeEnv(knob)).toThrow('AGENT_CLAUDE_ENV')
    expect(() => parseClaudeEnv(knob)).toThrow('not operator-settable')
  })

  test('refuses every name the route strips, walking STRIPPED_NAMES from claude-connect.ts', () => {
    // The behaviour pin, not just a constant comparison: a member added to the
    // strip list must join the refused set and be refused, or this fails.
    for (const name of STRIPPED_NAMES) {
      expect(REFUSED_NAMES).toContain(name)
      expect(() => parseClaudeEnv(JSON.stringify({ [name]: 'x' }))).toThrow('not operator-settable')
    }
  })
})
