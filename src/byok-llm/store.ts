// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { byokLlmCredentials, type ByokLlmCredentialRow } from '../db/byok-llm-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import type { LlmProviderAccount, LlmRoleBindings, Verification } from '../llm-providers/types.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload, type SecretPayload } from '../secret-payload-crypto.js'
import { decodeByokBlob, encodeByokBlob, type ByokBlobV2 } from './blob-codec.js'
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

const hasOwnConfigKey = (input: PartialByokLlmConfig, key: string): key is keyof PartialByokLlmConfig =>
  Object.prototype.hasOwnProperty.call(input, key)

const mergeConfigUpdate = (current: PartialByokLlmConfig, input: PartialByokLlmConfig): PartialByokLlmConfig => {
  const merged: PartialByokLlmConfig = { ...current }
  for (const key of BYOK_LLM_KEYS) {
    if (!hasOwnConfigKey(input, key)) continue
    const value = input[key]?.trim() ?? ''
    if (value.length === 0) merged[key] = undefined
    else merged[key] = value
  }
  return cleanConfig(merged)
}

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
  const updatedKeys = BYOK_LLM_KEYS.filter((key) => hasOwnConfigKey(config, key))
  const merged = mergeConfigUpdate(current, config)
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
  log.info({ contextId, updatedBy, keys: updatedKeys }, 'BYOK LLM config updated')
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

// ---------------------------------------------------------------------------
// Multi-provider BYOK blob operations (v2 shape)
// ---------------------------------------------------------------------------
// The v2 blob is a NESTED object, but `encryptSecretPayload` is typed as a flat
// `Record<string, string>`. To stay fully type-safe without `as` casts (forbidden
// by `no-unsafe-type-assertion`), the v2 blob is JSON-stringified and stored
// under the single key `'v2'`. Legacy payloads have no `'v2'` key and are lifted
// into v2 in-memory by `decodeByokBlob`.

export type ByokBundle = {
  readonly enabled: boolean
  readonly blob: ByokBlobV2 | null
  readonly unreadable: boolean
  readonly error: string | null
}

type DecodedBlob =
  | { readonly blob: ByokBlobV2 | null; readonly unreadable: false }
  | { readonly unreadable: true; readonly error: string }

// `JSON.parse` is typed `any`; annotating the return as `unknown` keeps the
// result from flowing as `any` (no-unsafe-assignment) without a cast.
const parseJson = (text: string): unknown => JSON.parse(text)

const decodeStoredPayload = (encryptedConfig: string | null): DecodedBlob => {
  if (encryptedConfig === null) return { blob: decodeByokBlob(null), unreadable: false }
  try {
    const payload = decryptSecretPayload(encryptedConfig)
    const raw = payload['v2'] === undefined ? payload : parseJson(payload['v2'])
    return { blob: decodeByokBlob(raw), unreadable: false }
  } catch {
    log.warn('BYOK LLM v2 blob is unreadable')
    return { unreadable: true, error: UNREADABLE_BYOK_CONFIG_ERROR }
  }
}

export function getByokBundle(contextId: string): ByokBundle {
  const row = findRow(contextId)
  if (row === undefined || !row.enabled) return { enabled: false, blob: null, unreadable: false, error: null }
  const decoded = decodeStoredPayload(row.encryptedConfig)
  if (decoded.unreadable) return { enabled: true, blob: null, unreadable: true, error: decoded.error }
  return { enabled: true, blob: decoded.blob, unreadable: false, error: null }
}

const writeBlob = (contextId: string, blob: ByokBlobV2, updatedBy: string): void => {
  const payload = encryptSecretPayload({ v2: JSON.stringify(encodeByokBlob(blob)) })
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig: payload, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: {
        encryptedConfig: sql`excluded.encrypted_config`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
}

const emptyRoles = (): LlmRoleBindings => ({ main: { providerId: '', model: '' }, small: null, embedding: null })

const rolesWithoutProvider = (roles: LlmRoleBindings, providerId: string): LlmRoleBindings => ({
  main: roles.main.providerId === providerId ? { providerId: '', model: '' } : roles.main,
  small: roles.small?.providerId === providerId ? null : roles.small,
  embedding: roles.embedding?.providerId === providerId ? null : roles.embedding,
})

export function upsertByokProvider(contextId: string, provider: LlmProviderAccount, updatedBy: string): void {
  const bundle = getByokBundle(contextId)
  const base: ByokBlobV2 = bundle.blob ?? { v: 2, providers: [], roles: emptyRoles() }
  const providers = [...base.providers.filter((p) => p.id !== provider.id), provider]
  writeBlob(contextId, { ...base, providers }, updatedBy)
}

export function deleteByokProvider(contextId: string, providerId: string, updatedBy: string): void {
  const bundle = getByokBundle(contextId)
  if (bundle.blob === null) return
  const providers = bundle.blob.providers.filter((p) => p.id !== providerId)
  const roles = rolesWithoutProvider(bundle.blob.roles, providerId)
  writeBlob(contextId, { ...bundle.blob, providers, roles }, updatedBy)
}

export function setByokRoles(contextId: string, roles: LlmRoleBindings, updatedBy: string): void {
  const bundle = getByokBundle(contextId)
  const base: ByokBlobV2 = bundle.blob ?? { v: 2, providers: [], roles }
  writeBlob(contextId, { ...base, roles }, updatedBy)
}

export function updateByokProviderVerification(
  contextId: string,
  providerId: string,
  verification: Verification,
  updatedBy: string,
): void {
  const bundle = getByokBundle(contextId)
  if (bundle.blob === null) return
  const providers = bundle.blob.providers.map((p) => (p.id === providerId ? { ...p, verification } : p))
  writeBlob(contextId, { ...bundle.blob, providers }, updatedBy)
}
