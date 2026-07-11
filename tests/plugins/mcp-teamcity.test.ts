// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { sanitizeTeamCityConfig } from '../../plugins/mcp-teamcity/format.js'

describe('mcp-teamcity sanitizeTeamCityConfig', () => {
  test('redacts a deeply nested secret inside a build-config tree', () => {
    const input = {
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: {
              property: [
                { name: 'env.SECRET_TOKEN', value: 'abc' },
                { name: 'system.foo', value: 'ok' },
              ],
            },
          },
        ],
      },
    }

    const result = sanitizeTeamCityConfig(input)

    expect(result).toEqual({
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: {
              property: [
                { name: 'env.SECRET_TOKEN', value: '[REDACTED]' },
                { name: 'system.foo', value: 'ok' },
              ],
            },
          },
        ],
      },
    })
  })

  test('regex covers common secret-name patterns and spares non-secret names', () => {
    const secretNames = ['password', 'apiToken', 'db.secret', 'ssh_key', 'my.credential.x']
    for (const name of secretNames) {
      const result = sanitizeTeamCityConfig({ name, value: 'v' })
      expect(result).toEqual({ name, value: '[REDACTED]' })
    }

    const nonSecretNames = ['buildNumber', 'system.teamcity.version', 'id']
    for (const name of nonSecretNames) {
      const result = sanitizeTeamCityConfig({ name, value: 'v' })
      expect(result).toEqual({ name, value: 'v' })
    }
  })

  test('does not redact falsy secret values', () => {
    expect(sanitizeTeamCityConfig({ name: 'token', value: '' })).toEqual({ name: 'token', value: '' })
    expect(sanitizeTeamCityConfig({ name: 'token', value: 0 })).toEqual({ name: 'token', value: 0 })
    expect(sanitizeTeamCityConfig({ name: 'token' })).toEqual({ name: 'token' })
  })

  test('redacts top-level parameters', () => {
    const input = { parameters: { property: [{ name: 'secret.x', value: 'y' }] } }

    const result = sanitizeTeamCityConfig(input)

    expect(result).toEqual({ parameters: { property: [{ name: 'secret.x', value: '[REDACTED]' }] } })
  })

  test('does not mutate the original input', () => {
    const original = {
      steps: {
        step: [
          {
            id: 'RUNNER_1',
            properties: {
              property: [{ name: 'env.SECRET_TOKEN', value: 'abc' }],
            },
          },
        ],
      },
    }

    sanitizeTeamCityConfig(original)

    expect(original.steps.step[0]?.properties.property[0]?.value).toBe('abc')
  })

  test('passes through non-record inputs unchanged', () => {
    expect(sanitizeTeamCityConfig(null)).toBe(null)
    expect(sanitizeTeamCityConfig('x')).toBe('x')
    expect(sanitizeTeamCityConfig(42)).toBe(42)
    expect(sanitizeTeamCityConfig([1, 'a', { name: 'token', value: 'z' }])).toEqual([
      1,
      'a',
      { name: 'token', value: '[REDACTED]' },
    ])
  })

  test('does not redact when name is not a string', () => {
    const result = sanitizeTeamCityConfig({ name: 123, value: 'x' })

    expect(result).toEqual({ name: 123, value: 'x' })
  })
})
