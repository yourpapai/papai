// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { logKey } from '../../opencode-agent/src/config-values.js'
import { ConfigError, loadConfig, loadOpenAiSettings } from '../../opencode-agent/src/config.js'
import { pipelineSecrets, redactSecrets, scrubSecrets } from '../../opencode-agent/src/secrets.js'

/** `openssl rand -base64 32`, and the bytes it decodes to. */
const KEY_B64 = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')

const ENV = {
  GITHUB_REPOSITORY: 'acme/widgets',
  GITHUB_TOKEN: 'tok',
  LLM_API_KEY: 'sk-test',
  LLM_BASE_URL: 'https://api.openai.com/v1',
  LLM_MODEL: 'gpt-5',
}

describe('logKey', () => {
  test('an unset AGENT_LOG_KEY is no key, not an error', () => {
    // Most runs have no transcript; the keyless case is the ordinary one.
    expect(logKey({}, 'AGENT_LOG_KEY')).toBeNull()
  })

  test('a valid `openssl rand -base64 32` value yields 32 bytes', () => {
    const key = logKey({ AGENT_LOG_KEY: KEY_B64 }, 'AGENT_LOG_KEY')

    expect(key).toBeInstanceOf(Uint8Array)
    expect(key?.byteLength).toBe(32)
    expect(key?.[0]).toBe(1)
  })

  test.each([
    ['not base64 at all', '!!!'],
    ['base64 of the wrong length', Buffer.from('short').toString('base64')],
    ['base64 that does not round-trip', `${KEY_B64.slice(0, -2)}XX`],
  ])('refuses a value that is %s, naming the variable', (_case, value) => {
    expect(() => logKey({ AGENT_LOG_KEY: value }, 'AGENT_LOG_KEY')).toThrow(ConfigError)
    expect(() => logKey({ AGENT_LOG_KEY: value }, 'AGENT_LOG_KEY')).toThrow('AGENT_LOG_KEY')
  })

  test('loadConfig surfaces the key on PipelineConfig, or null when unset', () => {
    expect(loadConfig(ENV, '/repo').logKey).toBeNull()

    const keyed = loadConfig({ ...ENV, AGENT_LOG_KEY: KEY_B64 }, '/repo')

    expect(keyed.logKey?.byteLength).toBe(32)
  })

  test('the key joins the pipeline secrets, so it is scrubbed and redacted like the rest', () => {
    // A symmetric key is a credential: the environment scrub and the outbound
    // redaction both read this one list, so it has to be on it.
    const config = loadConfig({ ...ENV, AGENT_LOG_KEY: KEY_B64 }, '/repo')

    expect(pipelineSecrets(config)).toContain(KEY_B64)
  })
})

/**
 * `LLM_PROVIDER` is a **catalogue key**, not a transport.
 *
 * OpenCode merges a config provider over its own models.dev-derived database
 * keyed by this id, so the id is what decides whether the model inherits a real
 * `limit.context` and `reasoning` flag or falls to the zero defaults — and a
 * zero context window switches auto-compaction off outright. The transport
 * stays `@ai-sdk/openai-compatible` either way, which is why this is one string
 * rather than a provider matrix.
 */
describe('LLM_PROVIDER', () => {
  test('defaults to `openai`, so an unset variable is exactly today', () => {
    expect(loadOpenAiSettings(ENV).provider).toBe('openai')
  })

  test('is read and trimmed when set', () => {
    expect(loadOpenAiSettings({ ...ENV, LLM_PROVIDER: '  anthropic  ' }).provider).toBe('anthropic')
    // A blank value is an unset one, like every other optional knob here.
    expect(loadOpenAiSettings({ ...ENV, LLM_PROVIDER: '   ' }).provider).toBe('openai')
  })

  test.each([
    // A slash would split `modelRef` at the wrong place: `parseModelRef` keeps
    // everything after the FIRST one, so `a/b` + `m` would parse as provider
    // `a`, model `b/m`.
    ['a slash', 'openai/gpt-5'],
    ['whitespace inside', 'open ai'],
    ['uppercase', 'OpenAI'],
    ['a leading separator', '-openai'],
    ['over-length', 'a'.repeat(65)],
  ])('refuses %s, naming the variable', (_case, value) => {
    expect(() => loadOpenAiSettings({ ...ENV, LLM_PROVIDER: value })).toThrow(ConfigError)
    expect(() => loadOpenAiSettings({ ...ENV, LLM_PROVIDER: value })).toThrow('LLM_PROVIDER')
  })

  test('loadConfig surfaces it on PipelineConfig', () => {
    expect(loadConfig({ ...ENV, LLM_PROVIDER: 'anthropic' }, '/repo').openai.provider).toBe('anthropic')
  })
})

/**
 * The last resort for a model no catalogue carries at all.
 *
 * `LLM_PROVIDER` reaches every hosted model models.dev knows; a self-hosted
 * alias or a fine-tune has no id that helps, and still lands on `limit.context:
 * 0` with auto-compaction switched off. These three say the facts outright.
 *
 * Absence is meaningful rather than defaulted: a default context window here
 * would be a guess about somebody else's server, and a wrong one either compacts
 * every turn or never compacts at all.
 */
describe('model metadata overrides', () => {
  test('are absent when unset, so a lower precedence tier can answer', () => {
    expect(loadOpenAiSettings(ENV).overrides).toEqual({ context: null, output: null, reasoning: null })
  })

  test('are read when set', () => {
    const settings = loadOpenAiSettings({
      ...ENV,
      AGENT_MODEL_CONTEXT: '131072',
      AGENT_MODEL_OUTPUT: '8192',
      AGENT_MODEL_REASONING: 'true',
    })

    expect(settings.overrides).toEqual({ context: 131_072, output: 8_192, reasoning: true })
  })

  test.each([
    // Below a single phase's own prompt budget, every turn would compact.
    ['a context window too small to hold one prompt', 'AGENT_MODEL_CONTEXT', '4000'],
    // Above any real model: a made-up huge window never reaches `usable`, so it
    // disables compaction exactly as effectively as leaving it at zero.
    ['a context window no model has', 'AGENT_MODEL_CONTEXT', '999999999'],
    // OpenCode clamps the output cap to its own OUTPUT_TOKEN_MAX, so a larger
    // value is a statement it will silently ignore.
    ['an output cap above what OpenCode will honour', 'AGENT_MODEL_OUTPUT', '64000'],
    ['a non-integer', 'AGENT_MODEL_CONTEXT', '128k'],
  ])('refuse %s, naming the variable', (_case, key, value) => {
    expect(() => loadOpenAiSettings({ ...ENV, [key]: value })).toThrow(ConfigError)
    expect(() => loadOpenAiSettings({ ...ENV, [key]: value })).toThrow(key)
  })

  test.each([
    ['true', true],
    ['false', false],
    ['TRUE', true],
  ])('read AGENT_MODEL_REASONING=%s as a boolean', (value, expected) => {
    expect(loadOpenAiSettings({ ...ENV, AGENT_MODEL_REASONING: value }).overrides?.reasoning).toBe(expected)
  })

  test.each(['yes', '1', 'maybe'])('refuse AGENT_MODEL_REASONING=%s rather than guessing', (value) => {
    expect(() => loadOpenAiSettings({ ...ENV, AGENT_MODEL_REASONING: value })).toThrow('AGENT_MODEL_REASONING')
  })
})

/**
 * Per-profile model and effort.
 *
 * The three agent profiles already differ by permission; these let them differ
 * by cost too. `plan` is the read-only one — triage, comment classification,
 * answering, both review gates — and it has been running on the same model as a
 * thirty-step implement turn.
 */
describe('per-profile model and effort', () => {
  test('are absent when unset, so the emitted config is exactly today', () => {
    expect(loadOpenAiSettings(ENV).profiles).toEqual({ light: null, planEffort: null, buildEffort: null })
  })

  test('are read and trimmed when set', () => {
    const settings = loadOpenAiSettings({
      ...ENV,
      LLM_MODEL_LIGHT: '  gpt-5-mini  ',
      AGENT_EFFORT_PLAN: 'low',
      AGENT_EFFORT_BUILD: 'xhigh',
    })

    expect(settings.profiles).toEqual({ light: 'gpt-5-mini', planEffort: 'low', buildEffort: 'xhigh' })
  })

  test.each([
    ['whitespace inside', 'AGENT_EFFORT_PLAN', 'very high'],
    ['uppercase', 'AGENT_EFFORT_BUILD', 'HIGH'],
    ['a slash', 'AGENT_EFFORT_BUILD', 'openai/high'],
    ['over-length', 'AGENT_EFFORT_PLAN', 'a'.repeat(17)],
  ])('refuse %s, naming the variable', (_case, key, value) => {
    expect(() => loadOpenAiSettings({ ...ENV, [key]: value })).toThrow(ConfigError)
    expect(() => loadOpenAiSettings({ ...ENV, [key]: value })).toThrow(key)
  })

  test('accept a tier this pipeline has never heard of (D4)', () => {
    // The valid set is model-dependent — `transform.ts` computes it from the
    // model id and its release date — so a hardcoded list here would reject
    // tiers that work and would be wrong on the next model. OpenCode rejects an
    // unknown tier, where the knowledge lives.
    expect(loadOpenAiSettings({ ...ENV, AGENT_EFFORT_BUILD: 'ludicrous' }).profiles?.buildEffort).toBe('ludicrous')
  })

  test('loadConfig surfaces them on PipelineConfig', () => {
    const config = loadConfig({ ...ENV, LLM_MODEL_LIGHT: 'gpt-5-mini' }, '/repo')

    expect(config.openai.profiles?.light).toBe('gpt-5-mini')
  })
})

/**
 * `AGENT_MCP_SERVERS` — the second non-scalar knob, riding `OpenAiSettings`
 * the way `profiles` does so the one config builder both execution paths read
 * carries it by construction.
 */
describe('AGENT_MCP_SERVERS', () => {
  const KNOB =
    '{"fetcher":{"type":"local","command":["bunx","mcp-server-fetch@1.0.0"],' +
    '"environment":{"FETCH_TIMEOUT_SECRET":"FETCH_TIMEOUT_SECRET"}},' +
    '"index":{"type":"remote","url":"https://mcp.example.com/sse",' +
    '"headers":{"Authorization":"Bearer tok-abcdefgh1234"}}}'

  test('is absent when unset, so the emitted config is exactly today', () => {
    expect(loadOpenAiSettings(ENV).mcpServers).toBeUndefined()
    expect(loadOpenAiSettings({ ...ENV, AGENT_MCP_SERVERS: '  ' }).mcpServers).toBeUndefined()
  })

  test('rides the settings as parsed when set', () => {
    const settings = loadOpenAiSettings({ ...ENV, AGENT_MCP_SERVERS: KNOB })

    expect(settings.mcpServers).toEqual({
      fetcher: {
        type: 'local',
        command: ['bunx', 'mcp-server-fetch@1.0.0'],
        environment: { FETCH_TIMEOUT_SECRET: 'FETCH_TIMEOUT_SECRET' },
      },
      index: {
        type: 'remote',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer tok-abcdefgh1234' },
      },
    })
  })

  test('loadConfig surfaces it on PipelineConfig', () => {
    expect(loadConfig({ ...ENV, AGENT_MCP_SERVERS: KNOB }, '/repo').openai.mcpServers?.['index']).toMatchObject({
      url: 'https://mcp.example.com/sse',
    })
  })

  test('an unloadable value fails at job start, naming the variable', () => {
    expect(() => loadOpenAiSettings({ ...ENV, AGENT_MCP_SERVERS: 'not json' })).toThrow(ConfigError)
    expect(() => loadOpenAiSettings({ ...ENV, AGENT_MCP_SERVERS: 'not json' })).toThrow('AGENT_MCP_SERVERS')
  })

  test('every headers and environment value joins the pipeline secrets', () => {
    // The scrub and the redaction both match by **value**, so a credential that
    // never appears in this list survives both. The header token here is
    // `Bearer tok-abcdefgh1234` — long enough to clear the minimum-length rule
    // on its own, which is what lets the two assertions below say "the value,
    // exactly".
    const config = loadConfig({ ...ENV, AGENT_MCP_SERVERS: KNOB }, '/repo')
    const secrets = pipelineSecrets(config)

    expect(secrets).toContain('Bearer tok-abcdefgh1234')
    expect(secrets).toContain('FETCH_TIMEOUT_SECRET')
  })

  test('the joined values leave the scrubbed environment and the outbound text', () => {
    const config = loadConfig({ ...ENV, AGENT_MCP_SERVERS: KNOB }, '/repo')
    const secrets = pipelineSecrets(config)
    const env: Record<string, string | undefined> = {
      LEAKED_HEADER: 'Bearer tok-abcdefgh1234',
      LEAKED_ENV: 'FETCH_TIMEOUT_SECRET',
      UNRELATED: 'harmless-value',
    }

    expect(scrubSecrets(env, secrets).sort()).toEqual(['LEAKED_ENV', 'LEAKED_HEADER'])
    expect(redactSecrets('token Bearer tok-abcdefgh1234 and FETCH_TIMEOUT_SECRET', secrets)).toBe(
      'token [redacted] and [redacted]',
    )
  })

  test('an unset knob changes the secret list not at all', () => {
    expect(pipelineSecrets(loadConfig(ENV, '/repo'))).toEqual(['tok', 'sk-test'])
  })
})
