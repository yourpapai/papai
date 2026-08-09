// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { logKey } from '../../opencode-agent/src/config-values.js'
import { ConfigError, loadConfig } from '../../opencode-agent/src/config.js'
import { pipelineSecrets } from '../../opencode-agent/src/secrets.js'

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
