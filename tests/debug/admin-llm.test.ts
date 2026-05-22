// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  AdminLlmError,
  applyAdminLlmUpdate,
  getAdminLlmSnapshot,
  type AdminLlmErrorKind,
} from '../../src/debug/admin-llm.js'
import { getSystemConfig, setSystemConfig } from '../../src/system-config.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from '../utils/test-helpers.js'

const captureError = (fn: () => void): AdminLlmError | null => {
  try {
    fn()
  } catch (err) {
    return err instanceof AdminLlmError ? err : null
  }
  return null
}

const expectErrorKind = (fn: () => void, kind: AdminLlmErrorKind): void => {
  const err = captureError(fn)
  expect(err).not.toBeNull()
  expect(err?.kind).toBe(kind)
}

describe('getAdminLlmSnapshot', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetSystemConfigCacheForTesting()
  })

  test('returns nulls for every key when system_config is empty', () => {
    const snap = getAdminLlmSnapshot()
    for (const key of ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'] as const) {
      expect(snap[key]).toEqual({ value: null, updatedAt: null, updatedBy: null })
    }
  })

  test('returns masked llm_apikey and cleartext for other keys', () => {
    setSystemConfig('llm_apikey', 'sk-abcd1234', 'admin-1')
    setSystemConfig('llm_baseurl', 'https://api.example.com/v1', 'env')
    setSystemConfig('main_model', 'gpt-9', 'admin-1')

    const snap = getAdminLlmSnapshot()
    expect(snap.llm_apikey.value).toBe('****1234')
    expect(typeof snap.llm_apikey.updatedAt).toBe('number')
    expect(snap.llm_apikey.updatedBy).toBe('admin-1')

    expect(snap.llm_baseurl.value).toBe('https://api.example.com/v1')
    expect(snap.llm_baseurl.updatedBy).toBe('env')

    expect(snap.main_model.value).toBe('gpt-9')

    expect(snap.small_model).toEqual({ value: null, updatedAt: null, updatedBy: null })
    expect(snap.embedding_model).toEqual({ value: null, updatedAt: null, updatedBy: null })
  })
})

describe('applyAdminLlmUpdate', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetSystemConfigCacheForTesting()
  })

  test('persists a valid update and returns the key + updatedAt', () => {
    const before = Date.now()
    const result = applyAdminLlmUpdate({ key: 'main_model', value: 'gpt-6' }, 'admin-99')
    const after = Date.now()

    expect(result.key).toBe('main_model')
    expect(result.updatedAt).toBeGreaterThanOrEqual(before)
    expect(result.updatedAt).toBeLessThanOrEqual(after)
    expect(getSystemConfig('main_model')).toBe('gpt-6')
  })

  test('trims whitespace from the value', () => {
    applyAdminLlmUpdate({ key: 'main_model', value: '  gpt-7  ' }, 'admin-99')
    expect(getSystemConfig('main_model')).toBe('gpt-7')
  })

  test('throws AdminLlmError with kind=bad-key for an unknown key', () => {
    expectErrorKind(() => {
      applyAdminLlmUpdate({ key: 'unknown', value: 'x' }, 'admin-1')
    }, 'bad-key')
  })

  test('throws AdminLlmError with kind=bad-value for an empty value', () => {
    expectErrorKind(() => {
      applyAdminLlmUpdate({ key: 'main_model', value: '' }, 'admin-1')
    }, 'bad-value')
  })

  test('throws AdminLlmError with kind=bad-value for whitespace-only value', () => {
    expectErrorKind(() => {
      applyAdminLlmUpdate({ key: 'main_model', value: '   ' }, 'admin-1')
    }, 'bad-value')
  })

  test('throws AdminLlmError with kind=bad-key for a non-object body', () => {
    expectErrorKind(() => {
      applyAdminLlmUpdate('not-an-object', 'admin-1')
    }, 'bad-key')
  })

  test('rejects user-config keys (e.g. kaneo_apikey) which are not SystemConfigKeys', () => {
    expectErrorKind(() => {
      applyAdminLlmUpdate({ key: 'kaneo_apikey', value: 'tok' }, 'admin-1')
    }, 'bad-key')
  })
})
