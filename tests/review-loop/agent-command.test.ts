// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AgentCommandError,
  buildAgentCommand,
  type AgentCommandOptions,
  type ClaudeSpawnContext,
} from '../../review-loop/src/agent-command.js'
import { ALLOWLISTS, analysisAllowlist } from '../../review-loop/src/claude-argv.js'

const CWD = '/repo/.review-loop/worktrees/42'

function claudeContext(overrides: Partial<ClaudeSpawnContext> = {}): ClaudeSpawnContext {
  return {
    profile: 'bare',
    credentialName: 'ANTHROPIC_API_KEY',
    credentialValue: 'sk-ant-secret-0123456789',
    configDir: '/tmp/review-loop-claude-run/spawn-1',
    mcpConfigPath: null,
    envSource: { PATH: '/usr/bin' },
    ...overrides,
  }
}

describe('buildAgentCommand (opencode branch)', () => {
  test('returns exactly today argv by full-array equality, with no stdin and no env', () => {
    const command = buildAgentCommand({
      model: 'test-model',
      cwd: CWD,
      prompt: 'review the code',
      extraArgs: [],
      label: 'reviewer',
    })

    expect(command).toEqual({
      command: 'opencode',
      args: ['run', '--auto', '--format', 'json', '--model', 'test-model', '--dir', CWD, 'review the code'],
    })
  })

  test('extraArgs ride after --dir and before the prompt, preserving order', () => {
    const command = buildAgentCommand({
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: ['--flag-a', '--flag-b', 'value'],
      label: 'reviewer',
    })

    expect(command.args).toEqual([
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      'm',
      '--dir',
      CWD,
      '--flag-a',
      '--flag-b',
      'value',
      'p',
    ])
    expect(command.stdin).toBeUndefined()
    expect(command.env).toBeUndefined()
  })

  test('an explicit opencode backend composes the same argv', () => {
    const command = buildAgentCommand({
      backend: 'opencode',
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
    })
    expect(command.command).toBe('opencode')
    expect(command.args).toEqual(['run', '--auto', '--format', 'json', '--model', 'm', '--dir', CWD, 'p'])
  })
})

describe('buildAgentCommand (claude argv branch)', () => {
  const tail = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default']

  test('bare profile: composes profile block, streaming tail, fixer allowlist and stripped model', () => {
    const command = buildAgentCommand({
      backend: 'claude',
      model: 'opencode/claude-sonnet-4-6',
      cwd: CWD,
      prompt: 'fix the issue',
      extraArgs: [],
      label: 'fixer-w1',
      claude: claudeContext({ profile: 'bare', credentialName: 'ANTHROPIC_API_KEY' }),
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual([
      '--bare',
      ...tail,
      '--allowedTools',
      ALLOWLISTS.fixer,
      '--model',
      'claude-sonnet-4-6',
    ])
    expect(command.stdin).toBe('fix the issue')
    expect(command.args).not.toContain('fix the issue')
  })

  test('native profile: neutralization pair mandatory with the empty-MCP document', () => {
    const command = buildAgentCommand({
      backend: 'claude',
      model: 'claude-sonnet-4-6',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
      claude: claudeContext({
        profile: 'native',
        credentialName: 'CLAUDE_CODE_OAUTH_TOKEN',
        credentialValue: 'oauth-token-0123456789',
        mcpConfigPath: '/tmp/review-loop-claude-run/spawn-1/empty-mcp.json',
      }),
    })

    expect(command.args).toEqual([
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '/tmp/review-loop-claude-run/spawn-1/empty-mcp.json',
      ...tail,
      '--allowedTools',
      analysisAllowlist(CWD),
      '--model',
      'claude-sonnet-4-6',
    ])
  })

  test('the analysis roles get the scoped-Write allowlist composed from the spawn cwd', () => {
    for (const label of ['reviewer', 'matcher', 'inspector-w3', 'inspector-aggregated']) {
      const command = buildAgentCommand({
        backend: 'claude',
        model: 'm',
        cwd: CWD,
        prompt: 'p',
        extraArgs: [],
        label,
        claude: claudeContext(),
      })
      const allowlist = command.args[command.args.indexOf('--allowedTools') + 1]
      expect(allowlist).toBe(analysisAllowlist(CWD))
    }
  })

  test('a bare model id passes through with no prefix to strip', () => {
    const command = buildAgentCommand({
      backend: 'claude',
      model: 'claude-opus-5',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'fixer',
      claude: claudeContext(),
    })
    expect(command.args[command.args.indexOf('--model') + 1]).toBe('claude-opus-5')
  })

  test('an optional system prompt is emitted via --append-system-prompt as a single argv entry', () => {
    const command = buildAgentCommand({
      backend: 'claude',
      model: 'm',
      cwd: CWD,
      prompt: 'p',
      extraArgs: [],
      label: 'reviewer',
      claude: claudeContext(),
      systemPrompt: 'Repo conventions: follow AGENTS.md.',
    })

    const index = command.args.indexOf('--append-system-prompt')
    expect(index).toBeGreaterThan(-1)
    expect(command.args[index + 1]).toBe('Repo conventions: follow AGENTS.md.')
  })

  test('a system prompt over MAX_ARG_STRLEN is refused with an error naming the byte cap and the component', () => {
    const compose = (): unknown =>
      buildAgentCommand({
        backend: 'claude',
        model: 'm',
        cwd: CWD,
        prompt: 'p',
        extraArgs: [],
        label: 'reviewer',
        claude: claudeContext(),
        systemPrompt: 'x'.repeat(131_073),
      })
    expect(compose).toThrow(AgentCommandError)
    expect(compose).toThrow(/131,072/u)
    expect(compose).toThrow(/system prompt/u)
  })

  test('a non-empty extraArgs is refused with an error naming the knob', () => {
    const compose = (): unknown =>
      buildAgentCommand({
        backend: 'claude',
        model: 'm',
        cwd: CWD,
        prompt: 'p',
        extraArgs: ['--dangerous'],
        label: 'reviewer',
        claude: claudeContext(),
      })
    expect(compose).toThrow(AgentCommandError)
    expect(compose).toThrow(/extraArgs/u)
  })

  test('backend claude without the claude context is refused with a named composition error', () => {
    expect(() =>
      buildAgentCommand({
        backend: 'claude',
        model: 'm',
        cwd: CWD,
        prompt: 'p',
        extraArgs: [],
        label: 'reviewer',
      }),
    ).toThrow(AgentCommandError)
  })
})

/**
 * The effort tier on the loop's role subprocesses (design D4, D6).
 *
 * The tier rides the per-role options beside `model` — the same kind of fact —
 * and the claude branch composes it immediately after `--model`, the position
 * the doctrine test's tail pin looks for. The opencode branch ignores it: on
 * that route the tier reaches the worker as `agent.build.variant` inside
 * `OPENCODE_CONFIG_CONTENT`, and an argv flag would be a second source of
 * truth for the same setting.
 */
describe('buildAgentCommand (the effort tier)', () => {
  const tail = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default']

  /** The claude-branch options, with the optional tier spread in only when named. */
  const claudeOptions = (effort?: string): AgentCommandOptions => ({
    backend: 'claude',
    model: 'opencode/claude-sonnet-4-6',
    cwd: CWD,
    prompt: 'p',
    extraArgs: [],
    label: 'reviewer',
    claude: claudeContext(),
    ...(effort === undefined ? {} : { effort }),
  })

  /** The opencode-branch options, with the optional tier spread in only when named. */
  const opencodeOptions = (effort?: string): AgentCommandOptions => ({
    backend: 'opencode',
    model: 'm',
    cwd: CWD,
    prompt: 'p',
    extraArgs: [],
    label: 'reviewer',
    ...(effort === undefined ? {} : { effort }),
  })

  test('the claude branch emits --effort adjacent to --model when a tier is set (D6)', () => {
    const command = buildAgentCommand(claudeOptions('high'))

    expect(command.args).toEqual([
      '--bare',
      ...tail,
      '--allowedTools',
      analysisAllowlist(CWD),
      '--model',
      'claude-sonnet-4-6',
      '--effort',
      'high',
    ])
  })

  test('an absent tier composes no --effort — the claude argv is byte-identical to today’s', () => {
    const command = buildAgentCommand(claudeOptions())

    expect(command.args).toEqual([
      '--bare',
      ...tail,
      '--allowedTools',
      analysisAllowlist(CWD),
      '--model',
      'claude-sonnet-4-6',
    ])
  })

  test('the opencode branch ignores the tier — byte-identical argv either way (D6)', () => {
    expect(buildAgentCommand(opencodeOptions('high'))).toEqual(buildAgentCommand(opencodeOptions()))
  })
})

/** The composed claude child env for one context, so env-leg test bodies carry no rebuild boilerplate. */
function composedClaudeEnv(overrides: Partial<ClaudeSpawnContext> = {}): Record<string, string> {
  const command = buildAgentCommand({
    backend: 'claude',
    model: 'm',
    cwd: CWD,
    prompt: 'p',
    extraArgs: [],
    label: 'reviewer',
    claude: claudeContext(overrides),
  })
  const env = command.env
  if (env === undefined) throw new Error('claude branch returned no env')
  return env
}

describe('buildAgentCommand (claude env branch)', () => {
  // The CI forwarding shape: unset secrets arrive as the empty string.
  function forwardingEnvSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      PATH: '/usr/bin:/bin',
      HOME: '/home/runner',
      LLM_API_KEY: '',
      LLM_BASE_URL: '',
      ANTHROPIC_API_KEY: 'sk-ant-secret-0123456789',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      OPENCODE_CONFIG_CONTENT: '{"provider": {"options": {"apiKey": "gateway-secret"}}}',
      AGENT_MCP_SERVERS: '{"servers": {"embedded": {"headers": {"auth": "secret-inside"}}}}',
      ANTHROPIC_BASE_URL: 'https://evil.example',
      ANTHROPIC_AUTH_TOKEN: 'ambient-auth-token',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Evil: 1',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example',
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example',
      GIT_AUTHOR_NAME: 'review-bot',
      GIT_AUTHOR_EMAIL: 'bot@example',
      GIT_COMMITTER_NAME: 'review-bot',
      HTTPS_PROXY: 'http://proxy.corp:3128',
      HTTP_PROXY: 'http://proxy.corp:3128',
      ALL_PROXY: 'socks5://proxy.corp:1080',
      NO_PROXY: 'localhost,127.0.0.1',
      ...overrides,
    }
  }

  test('every D5-stripped name is absent from the composed env', () => {
    const env = composedClaudeEnv({ envSource: forwardingEnvSource() })
    for (const name of [
      'LLM_API_KEY',
      'LLM_BASE_URL',
      'OPENCODE_CONFIG_CONTENT',
      'AGENT_MCP_SERVERS',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_CUSTOM_HEADERS',
      'CLAUDE_CODE_USE_BEDROCK',
      'ANTHROPIC_BEDROCK_BASE_URL',
      'CLAUDE_CODE_USE_VERTEX',
      'ANTHROPIC_VERTEX_BASE_URL',
    ]) {
      expect(name in env).toBe(false)
    }
    // The non-selected Anthropic spelling is stripped too (OAuth was '' here,
    // but the strip is by name so a live value cannot cross either).
    expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false)
  })

  test('exactly the selected credential, CLAUDE_CONFIG_DIR and DISABLE_AUTOUPDATER are added', () => {
    const configDir = '/tmp/review-loop-claude-run/spawn-7'
    const env = composedClaudeEnv({ configDir, envSource: forwardingEnvSource() })
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-secret-0123456789')
    expect(env['CLAUDE_CONFIG_DIR']).toBe(configDir)
    expect(env['DISABLE_AUTOUPDATER']).toBe('1')
  })

  test('an inherited non-stripped identity name is present, pinning the try-side process.env read', () => {
    const env = composedClaudeEnv({ envSource: forwardingEnvSource() })
    expect(env['GIT_AUTHOR_NAME']).toBe('review-bot')
    expect(env['GIT_COMMITTER_NAME']).toBe('review-bot')
    expect(env['PATH']).toBe('/usr/bin:/bin')
  })

  test('standard proxy variables stay inherited', () => {
    const env = composedClaudeEnv({ envSource: forwardingEnvSource() })
    expect(env['HTTPS_PROXY']).toBe('http://proxy.corp:3128')
    expect(env['HTTP_PROXY']).toBe('http://proxy.corp:3128')
    expect(env['ALL_PROXY']).toBe('socks5://proxy.corp:1080')
    expect(env['NO_PROXY']).toBe('localhost,127.0.0.1')
  })

  test('a credential spelling not matching the profile injects nothing', () => {
    // Hand-built builder-seam input only: a run path cannot diverge (the
    // resolver derives the profile from the surviving spelling).
    const env = composedClaudeEnv({
      profile: 'bare',
      credentialName: 'CLAUDE_CODE_OAUTH_TOKEN',
      credentialValue: 'oauth-token-0123456789',
      envSource: forwardingEnvSource(),
    })
    expect('ANTHROPIC_API_KEY' in env).toBe(false)
    expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false)
  })

  test('the native profile re-adds the OAuth spelling alone', () => {
    const env = composedClaudeEnv({
      profile: 'native',
      credentialName: 'CLAUDE_CODE_OAUTH_TOKEN',
      credentialValue: 'oauth-token-0123456789',
      mcpConfigPath: '/tmp/review-loop-claude-run/spawn-1/empty-mcp.json',
      envSource: forwardingEnvSource({ ANTHROPIC_API_KEY: 'sk-ant-live-key-0123456789' }),
    })
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('oauth-token-0123456789')
    expect('ANTHROPIC_API_KEY' in env).toBe(false)
  })
})
