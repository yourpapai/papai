// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { DEFAULT_STALL_TIMEOUT_MS, stallTimeoutMs, STALL_RANGE } from '../../opencode-agent/src/config-values.js'
import { ConfigError, loadConfig } from '../../opencode-agent/src/config.js'

/**
 * `AGENT_STALL_TIMEOUT_MS` — the mid-turn provider-stall bound.
 *
 * The whole-turn deadline (`AGENT_TIMEOUT_MS`) is a clock: it fires on elapsed
 * time whether the provider is serving the turn or not, and the incident that
 * added this knob was four runs that burned 90 minutes each inside one — the
 * gateway answered HTTP 200, streamed nothing, and the SDK retried the identical
 * request 78 times while nothing in the pipeline had a health question to ask.
 * This knob is that question: abort a turn that has made no progress for this
 * long *while* provider retries or session errors accumulate.
 *
 * `0` is special and is the reason this is not a plain `boundedInt`: an
 * operator investigating the provider needs to be able to run the old behaviour
 * — the whole-turn deadline as the only turn bound — and a range whose minimum
 * is the disable value would refuse every other small window as a side effect.
 */

const ENV = {
  GITHUB_REPOSITORY: 'acme/widgets',
  GITHUB_TOKEN: 'tok',
  LLM_API_KEY: 'sk-test',
  LLM_BASE_URL: 'https://api.openai.com/v1',
  LLM_MODEL: 'gpt-5',
}

const read = (value: string | undefined): number =>
  stallTimeoutMs(
    value === undefined ? {} : { AGENT_STALL_TIMEOUT_MS: value },
    'AGENT_STALL_TIMEOUT_MS',
    DEFAULT_STALL_TIMEOUT_MS,
    STALL_RANGE,
  )

describe('AGENT_STALL_TIMEOUT_MS', () => {
  test('defaults to five minutes, which sits above every recovering blip and far below a dead spiral', () => {
    // From the incident data: a sibling run recovered from every episode of
    // ≤9 attempts (~4.5 min at ~30 s per attempt), while the dead spirals ran
    // 57–90 minutes. The default has to live between them.
    expect(read(undefined)).toBe(300_000)
  })

  test('the default is itself a value the range would accept, so the pair cannot drift', () => {
    expect(STALL_RANGE.min).toBeLessThanOrEqual(DEFAULT_STALL_TIMEOUT_MS)
    expect(DEFAULT_STALL_TIMEOUT_MS).toBeLessThanOrEqual(STALL_RANGE.max)
  })

  test('reads an explicit window', () => {
    expect(read('600000')).toBe(600_000)
  })

  test('`0` parses as the explicit off switch, not as a range violation', () => {
    // An operator investigating the provider should be able to run the old
    // behaviour: the whole-turn deadline as the only turn bound.
    expect(read('0')).toBe(0)
  })

  test.each([
    ['a non-numeric value', 'banana'],
    ['a float', '1.5'],
    ['a value with a unit glued on', '300000ms'],
  ])('refuses %s, naming the variable', (_case, value) => {
    expect(() => read(value)).toThrow(ConfigError)
    expect(() => read(value)).toThrow('AGENT_STALL_TIMEOUT_MS')
  })

  test.each([
    ['below one retry cycle', '59999'],
    ['negative', '-1'],
    ['above any turn the whole-turn cap would allow', '7200001'],
  ])('refuses a non-zero window that is %s', (_case, value) => {
    // Under one retry cycle the bound fires on ordinary recovering blips —
    // the sibling run's episodes were 4.5 minutes and healthy. Over the turn
    // cap it can never fire, which removes the bound by setting it.
    expect(() => read(value)).toThrow(ConfigError)
    expect(() => read(value)).toThrow('AGENT_STALL_TIMEOUT_MS')
  })

  test('loadConfig surfaces it on PipelineConfig', () => {
    expect(loadConfig(ENV, '/repo').stallTimeoutMs).toBe(300_000)
    expect(loadConfig({ ...ENV, AGENT_STALL_TIMEOUT_MS: '0' }, '/repo').stallTimeoutMs).toBe(0)
  })

  test('an unloadable value fails config load, naming the variable', () => {
    expect(() => loadConfig({ ...ENV, AGENT_STALL_TIMEOUT_MS: 'banana' }, '/repo')).toThrow(ConfigError)
    expect(() => loadConfig({ ...ENV, AGENT_STALL_TIMEOUT_MS: 'banana' }, '/repo')).toThrow('AGENT_STALL_TIMEOUT_MS')
  })
})
