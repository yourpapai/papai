// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { byokLlmCredentials, type ByokLlmCredentialRow } from '../db/byok-llm-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload, type SecretPayload } from '../secret-payload-crypto.js'
import {
  BYOK_LLM_KEYS,
  REQUIRED_BYOK_LLM_KEYS,
  type ByokAdminSummary,
  type ByokCredentialState,
  type PartialByokLlmConfig,
  type RequiredByokLlmKey,
} from './types.js'

const log = logger.child({ scope: 'byok-llm:store' })
const UNREADABLE_BYOK_CONFIG_ERROR = 'stored BYOK LLM credentials are unreadable'

type DecryptedConfigResult =
  | { readonly kind: 'readable'; readonly config: PartialByokLlmConfig | null }
  | { readonly kind: 'unreadable'; readonly error: string }

const now = (): number => Date.now()

const cleanConfig = (input: PartialByokLlmConfig): PartialByokLlmConfig =>
  Object.fromEntries(
    BYOK_LLM_KEYS.flatMap((key) => {
      const value = input[key]?.trim()
      return value === undefined || value.length === 0 ? [] : [[key, value]]
    }),
  ) as PartialByokLlmConfig

const missingRequired = (config: PartialByokLlmConfig | null): ByokCredentialState['missing'] =>
  REQUIRED_BYOK_LLM_KEYS.filter((key) => {
    const value = config?.[key]?.trim()
    return value === undefined || value.length === 0
  })

const missingAllRequired = (): readonly RequiredByokLlmKey[] => [...REQUIRED_BYOK_LLM_KEYS]

const decryptConfig = (contextId: string, encryptedConfig: string | null): DecryptedConfigResult => {
  if (encryptedConfig === null) return { kind: 'readable', config: null }

  try {
    return { kind: 'readable', config: cleanConfig(decryptSecretPayload(encryptedConfig) as PartialByokLlmConfig) }
  } catch {
    log.warn({ contextId }, 'BYOK LLM config is unreadable')
    return { kind: 'unreadable', error: UNREADABLE_BYOK_CONFIG_ERROR }
  }
}

const stateForEnabledRow = (row: ByokLlmCredentialRow): ByokCredentialState => {
  const decrypted = decryptConfig(row.contextId, row.encryptedConfig)
  if (decrypted.kind === 'unreadable') {
    return {
      enabled: true,
      complete: false,
      missing: missingAllRequired(),
      unreadable: true,
      error: decrypted.error,
    }
  }

  const missing = missingRequired(decrypted.config)
  return { enabled: true, complete: missing.length === 0, missing }
}

const stateForRow = (row: ByokLlmCredentialRow): ByokCredentialState =>
  row.enabled ? stateForEnabledRow(row) : { enabled: false, complete: false, missing: [] }

const toSecretPayload = (config: PartialByokLlmConfig): SecretPayload =>
  Object.fromEntries(
    BYOK_LLM_KEYS.flatMap((key) => {
      const value = config[key]
      return value === undefined ? [] : [[key, value]]
    }),
  ) as SecretPayload

const findRow = (contextId: string): ByokLlmCredentialRow | undefined =>
  getDrizzleDb().select().from(byokLlmCredentials).where(eq(byokLlmCredentials.contextId, contextId)).get()

export function enableByokForContext(contextId: string, updatedBy: string): void {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig: null, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: { enabled: true, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
  log.info({ contextId, updatedBy }, 'BYOK enabled for context')
}

export function disableByokForContext(contextId: string, updatedBy: string): void {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: false, encryptedConfig: null, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: { enabled: false, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
  log.info({ contextId, updatedBy }, 'BYOK disabled for context')
}

export function updateByokLlmConfig(contextId: string, config: PartialByokLlmConfig, updatedBy: string): void {
  const current = getByokLlmConfig(contextId) ?? {}
  const cleanedInput = cleanConfig(config)
  const merged = cleanConfig({ ...current, ...cleanedInput })
  const encryptedConfig = encryptSecretPayload(toSecretPayload(merged))

  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: {
        encryptedConfig: sql`excluded.encrypted_config`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
  log.info({ contextId, updatedBy, keys: Object.keys(cleanedInput) }, 'BYOK LLM config updated')
}

export function getByokLlmConfig(contextId: string): PartialByokLlmConfig | null {
  const row = findRow(contextId)
  if (row === undefined) return null
  const decrypted = decryptConfig(contextId, row.encryptedConfig)
  return decrypted.kind === 'readable' ? decrypted.config : null
}

export function getByokCredentialState(contextId: string): ByokCredentialState {
  const row = findRow(contextId)
  if (row === undefined) return { enabled: false, complete: false, missing: [] }
  return stateForRow(row)
}

export function listByokAdminSummaries(): ByokAdminSummary[] {
  return getDrizzleDb()
    .select()
    .from(byokLlmCredentials)
    .all()
    .map((row): ByokAdminSummary => {
      const state = stateForRow(row)
      return {
        contextId: row.contextId,
        ...state,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      }
    })
}
