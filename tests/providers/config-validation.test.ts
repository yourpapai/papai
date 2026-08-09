// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import {
  validateEffectiveTaskProviderConfigResult,
  validateTaskInstanceConfigResult,
  type TaskInstanceConfigValidationDeps,
  type TaskInstanceConfigValidationFailure,
} from '../../src/providers/config-validation.js'
import type { TaskProviderConfigValidator, TaskProviderTypeDescriptor } from '../../src/providers/registry.js'
import type { ProviderConfigField } from '../../src/providers/types.js'

const makeField = (key: string, overrides: Partial<ProviderConfigField> = {}): ProviderConfigField => ({
  key,
  label: key,
  required: true,
  sensitive: false,
  scope: 'instance',
  ...overrides,
})

const makeDescriptor = (
  instance: readonly ProviderConfigField[],
  context: readonly ProviderConfigField[] = [],
): TaskProviderTypeDescriptor => ({
  type: 'demo',
  displayName: 'Demo',
  source: { plugin: 'demo-plugin' },
  instanceConfigSchema: instance,
  contextConfigSchema: context,
  capabilities: new Set(),
  traits: new Set(),
})

const makeDeps = (
  descriptor: TaskProviderTypeDescriptor | undefined,
  validator?: TaskProviderConfigValidator,
): TaskInstanceConfigValidationDeps => ({
  getTaskProviderDescriptor: (): TaskProviderTypeDescriptor | undefined => descriptor,
  getTaskProviderConfigValidator: (): TaskProviderConfigValidator | undefined => validator,
})

const invalidOf = (
  result: TaskInstanceConfigValidationFailure | null,
): Extract<TaskInstanceConfigValidationFailure, { kind: 'invalid_task_instance_config' }> => {
  if (result === null || result.kind !== 'invalid_task_instance_config') {
    throw new Error(`expected invalid_task_instance_config, got ${result === null ? 'null' : result.kind}`)
  }
  return result
}

const kindOf = (result: TaskInstanceConfigValidationFailure | null): string => {
  if (result === null) throw new Error('expected a failure, got null')
  return result.kind
}

const typeOf = (result: TaskInstanceConfigValidationFailure | null): string => {
  if (result === null) throw new Error('expected a failure, got null')
  return result.type
}

const reasonOf = (result: TaskInstanceConfigValidationFailure | null): string => {
  if (result === null) throw new Error('expected a failure, got null')
  if (
    result.kind !== 'task_provider_config_validator_failed' &&
    result.kind !== 'task_provider_config_validator_rejected'
  ) {
    throw new Error(`expected a reason-bearing failure, got ${result.kind}`)
  }
  return result.reason
}

const firstCallArg = (validator: {
  mock: { calls: readonly (readonly Record<string, string>[])[] }
}): Record<string, string> => {
  const call = validator.mock.calls[0]
  if (call === undefined) throw new Error('validator was not called')
  const arg = call[0]
  if (arg === undefined) throw new Error('validator call had no argument')
  return arg
}

describe('config-validation', () => {
  test('a whitespace-only required value is reported as missing', async () => {
    const deps = makeDeps(makeDescriptor([makeField('name')]))

    const result = await validateTaskInstanceConfigResult('demo', { name: '   ' }, deps)

    const failure = invalidOf(result)
    expect(failure.kind).toBe('invalid_task_instance_config')
    expect(failure.type).toBe('demo')
    expect(failure.missing.length).toBe(1)
    expect(failure.missing[0]).toBe('name')
    expect(failure.invalidUrls.length).toBe(0)
  })

  test('a non-http url field value is reported in invalidUrls', async () => {
    const descriptor = makeDescriptor([makeField('apiKey'), makeField('baseUrl', { required: false })])

    const result = await validateTaskInstanceConfigResult(
      'demo',
      { apiKey: 'k', baseUrl: 'ftp://x.invalid' },
      makeDeps(descriptor),
    )

    const failure = invalidOf(result)
    expect(failure.missing.length).toBe(0)
    expect(failure.invalidUrls.length).toBe(1)
    expect(failure.invalidUrls[0]).toBe('baseUrl')
  })

  test('a blank optional url field value is not flagged as an invalid url', async () => {
    const descriptor = makeDescriptor([makeField('apiKey'), makeField('baseUrl', { required: false })])

    const result = await validateTaskInstanceConfigResult('demo', { apiKey: 'k', baseUrl: '   ' }, makeDeps(descriptor))

    expect(result).toBeNull()
  })

  test('an http url is a valid url', async () => {
    const descriptor = makeDescriptor([makeField('baseUrl')])

    const result = await validateTaskInstanceConfigResult(
      'demo',
      { baseUrl: 'http://example.com' },
      makeDeps(descriptor),
    )

    expect(result).toBeNull()
  })

  test('a value that cannot be parsed as a url is reported in invalidUrls', async () => {
    const descriptor = makeDescriptor([makeField('apiKey'), makeField('baseUrl', { required: false })])

    const result = await validateTaskInstanceConfigResult(
      'demo',
      { apiKey: 'k', baseUrl: 'not a url' },
      makeDeps(descriptor),
    )

    const failure = invalidOf(result)
    expect(failure.invalidUrls.length).toBe(1)
    expect(failure.invalidUrls[0]).toBe('baseUrl')
  })

  test('a throwing validator yields validator_failed with the thrown message', async () => {
    const validator = mock((_config: Record<string, string>) => {
      throw new Error('boom: detail')
    })
    const deps = makeDeps(makeDescriptor([makeField('apiKey')]), validator)

    const result = await validateTaskInstanceConfigResult('demo', { apiKey: 'k' }, deps)

    expect(result).not.toBeNull()
    expect(kindOf(result)).toBe('task_provider_config_validator_failed')
    expect(reasonOf(result)).toBe('boom: detail')
  })

  test('a rejecting validator yields validator_rejected with the given reason', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: false, reason: 'nope' }))
    const deps = makeDeps(makeDescriptor([makeField('apiKey')]), validator)

    const result = await validateTaskInstanceConfigResult('demo', { apiKey: 'k' }, deps)

    expect(result).not.toBeNull()
    expect(kindOf(result)).toBe('task_provider_config_validator_rejected')
    expect(reasonOf(result)).toBe('nope')
  })

  test('an absent optional field is dropped from the validator config argument', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    const deps = makeDeps(makeDescriptor([makeField('a'), makeField('b', { required: false })]), validator)

    await validateTaskInstanceConfigResult('demo', { a: '1' }, deps)

    expect(validator).toHaveBeenCalledTimes(1)
    const arg = firstCallArg(validator)
    expect(Object.keys(arg).length).toBe(1)
    expect(arg['a']).toBe('1')
  })

  test('instance validator scope passes only instance fields to the validator', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    const deps = makeDeps(makeDescriptor([makeField('a')], [makeField('token', { scope: 'context' })]), validator)

    await validateTaskInstanceConfigResult('demo', { a: '1', token: 't' }, deps, 'storage', 'instance')

    expect(validator).toHaveBeenCalledTimes(1)
    const arg = firstCallArg(validator)
    expect(Object.keys(arg).length).toBe(1)
    expect(arg['a']).toBe('1')
  })

  test('resolved validator scope passes instance and context fields to the validator', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    const deps = makeDeps(makeDescriptor([makeField('a')], [makeField('token', { scope: 'context' })]), validator)

    await validateTaskInstanceConfigResult('demo', { a: '1', token: 't' }, deps, 'storage', 'resolved')

    expect(validator).toHaveBeenCalledTimes(1)
    const arg = firstCallArg(validator)
    expect(Object.keys(arg).length).toBe(2)
    expect(arg['a']).toBe('1')
    expect(arg['token']).toBe('t')
  })

  test('an unknown task provider type returns unknown_task_provider', async () => {
    const result = await validateTaskInstanceConfigResult('ghost', {}, makeDeps(undefined))

    expect(result).not.toBeNull()
    expect(kindOf(result)).toBe('unknown_task_provider')
    expect(typeOf(result)).toBe('ghost')
  })

  test('an unknown task provider type returns unknown_task_provider from the effective validator', async () => {
    const result = await validateEffectiveTaskProviderConfigResult('ghost', {}, makeDeps(undefined))

    expect(result).not.toBeNull()
    expect(kindOf(result)).toBe('unknown_task_provider')
    expect(typeOf(result)).toBe('ghost')
  })

  test('a missing required field short-circuits to invalid_task_instance_config before the validator', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    const deps = makeDeps(makeDescriptor([makeField('apiKey')]), validator)

    const result = await validateTaskInstanceConfigResult('demo', {}, deps)

    const failure = invalidOf(result)
    expect(failure.missing.length).toBe(1)
    expect(failure.missing[0]).toBe('apiKey')
    expect(validator).not.toHaveBeenCalled()
  })

  test('the effective validator requires context-scoped fields', async () => {
    const deps = makeDeps(makeDescriptor([makeField('baseUrl')], [makeField('token', { scope: 'context' })]))

    const result = await validateEffectiveTaskProviderConfigResult('demo', { baseUrl: 'https://x.invalid' }, deps)

    const failure = invalidOf(result)
    expect(failure.missing.length).toBe(1)
    expect(failure.missing[0]).toBe('token')
  })

  test('the effective validator flags an invalid url when all required fields are present', async () => {
    const descriptor = makeDescriptor([makeField('apiKey'), makeField('baseUrl', { required: false })])

    const result = await validateEffectiveTaskProviderConfigResult(
      'demo',
      { apiKey: 'k', baseUrl: 'ftp://x.invalid' },
      makeDeps(descriptor),
    )

    const failure = invalidOf(result)
    expect(failure.missing.length).toBe(0)
    expect(failure.invalidUrls.length).toBe(1)
    expect(failure.invalidUrls[0]).toBe('baseUrl')
  })

  test('a throwing effective validator yields validator_failed with the thrown message', async () => {
    const validator = mock((_config: Record<string, string>) => {
      throw new Error('eff: detail')
    })
    const deps = makeDeps(makeDescriptor([makeField('baseUrl')], [makeField('token', { scope: 'context' })]), validator)

    const result = await validateEffectiveTaskProviderConfigResult(
      'demo',
      { baseUrl: 'https://x.invalid', token: 't' },
      deps,
    )

    expect(result).not.toBeNull()
    expect(kindOf(result)).toBe('task_provider_config_validator_failed')
    expect(reasonOf(result)).toBe('eff: detail')
  })

  test('a rejecting effective validator yields validator_rejected with the given reason', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: false, reason: 'denied' }))
    const deps = makeDeps(makeDescriptor([makeField('baseUrl')], [makeField('token', { scope: 'context' })]), validator)

    const result = await validateEffectiveTaskProviderConfigResult(
      'demo',
      { baseUrl: 'https://x.invalid', token: 't' },
      deps,
    )

    expect(result).not.toBeNull()
    expect(kindOf(result)).toBe('task_provider_config_validator_rejected')
    expect(reasonOf(result)).toBe('denied')
  })

  test('the effective validator resolves a storageKey-bearing field by its logical key under the default mode', async () => {
    const validator = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    const deps = makeDeps(makeDescriptor([makeField('apiKey', { storageKey: 'secret_key' })]), validator)

    const result = await validateEffectiveTaskProviderConfigResult('demo', { apiKey: 'val' }, deps)

    expect(result).toBeNull()
    expect(validator).toHaveBeenCalledTimes(1)
    const arg = firstCallArg(validator)
    expect(Object.keys(arg).length).toBe(1)
    expect(arg['apiKey']).toBe('val')
  })
})
