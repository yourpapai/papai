import { afterEach, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import * as behaviorAuditConfig from '../../scripts/behavior-audit/config.js'
import { createAuditBehaviorConfig } from './behavior-audit-integration.helpers.js'
import { applyBehaviorAuditEnv, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { isObject } from './behavior-audit-integration.support.js'

type ReloadableConfigModule = {
  readonly REPORTS_DIR: string
  readonly MAX_RETRIES: number
  readonly reloadBehaviorAuditConfig: () => void
}

function isReloadableConfigModule(value: unknown): value is ReloadableConfigModule {
  return (
    isObject(value) &&
    'reloadBehaviorAuditConfig' in value &&
    typeof value['reloadBehaviorAuditConfig'] === 'function' &&
    'REPORTS_DIR' in value &&
    typeof value['REPORTS_DIR'] === 'string' &&
    'MAX_RETRIES' in value &&
    typeof value['MAX_RETRIES'] === 'number'
  )
}

// Capture the default MAX_RETRIES before any test mutates the env. This is
// safe because no setup hook alters BEHAVIOR_AUDIT_MAX_RETRIES before
// module evaluation, and afterEach restores the env after each test.
const defaultMaxRetries = Number(process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] ?? '3')

afterEach(() => {
  restoreBehaviorAuditEnv()
})

test('reloadBehaviorAuditConfig reapplies env overrides to exported config values', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')
  const config = loadedConfig

  process.env['BEHAVIOR_AUDIT_REPORTS_DIR'] = '/tmp/behavior-audit-reports'
  process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '7'

  config.reloadBehaviorAuditConfig()

  expect(config.REPORTS_DIR).toBe('/tmp/behavior-audit-reports')
  expect(config.MAX_RETRIES).toBe(7)
})

test('EMBEDDING_MODEL defaults to Qwen3-Embedding-8B when not set', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  delete process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['EMBEDDING_MODEL']).toBe('Qwen3-Embedding-8B')
})

test('EMBEDDING_BASE_URL defaults to BASE_URL when not set', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'http://myserver:9000/v1'
  delete process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['EMBEDDING_BASE_URL']).toBe('http://myserver:9000/v1')
})

test('EMBEDDING_BASE_URL can be overridden independently of BASE_URL', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'http://main:8000/v1'
  process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL'] = 'http://embed:7000/v1'
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['BASE_URL']).toBe('http://main:8000/v1')
  expect((loadedConfig as Record<string, unknown>)['EMBEDDING_BASE_URL']).toBe('http://embed:7000/v1')
})

test('CONSOLIDATION_THRESHOLD defaults to 0.92', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['CONSOLIDATION_THRESHOLD']).toBe(0.92)
})

test('CONSOLIDATION_DRY_RUN defaults to false', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['CONSOLIDATION_DRY_RUN']).toBe(false)
})

test('CONSOLIDATION_DRY_RUN reads env value 1 as true', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN'] = '1'
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['CONSOLIDATION_DRY_RUN']).toBe(true)
})

test('restoreBehaviorAuditEnv also restores live config exports for already-loaded modules', () => {
  const testConfig = createAuditBehaviorConfig('/tmp/behavior-audit-runtime-helper', null)
  applyBehaviorAuditEnv({ ...testConfig, MAX_RETRIES: 0 })
  behaviorAuditConfig.reloadBehaviorAuditConfig()

  expect(behaviorAuditConfig.MAX_RETRIES).toBe(0)
  restoreBehaviorAuditEnv()

  expect(behaviorAuditConfig.MAX_RETRIES).toBe(defaultMaxRetries)
})

test('applyBehaviorAuditEnv applies clustering overrides through shared config helper', () => {
  const testConfig = createAuditBehaviorConfig('/tmp/behavior-audit-runtime-helper', {
    CONSOLIDATION_MIN_CLUSTER_SIZE: 4,
    CONSOLIDATION_LINKAGE: 'average',
    CONSOLIDATION_MAX_CLUSTER_SIZE: 7,
    CONSOLIDATION_GAP_THRESHOLD: 0.2,
  })

  applyBehaviorAuditEnv(testConfig)
  behaviorAuditConfig.reloadBehaviorAuditConfig()

  expect(behaviorAuditConfig.CONSOLIDATION_MIN_CLUSTER_SIZE).toBe(4)
  expect(behaviorAuditConfig.CONSOLIDATION_LINKAGE).toBe('average')
  expect(behaviorAuditConfig.CONSOLIDATION_MAX_CLUSTER_SIZE).toBe(7)
  expect(behaviorAuditConfig.CONSOLIDATION_GAP_THRESHOLD).toBe(0.2)
})
