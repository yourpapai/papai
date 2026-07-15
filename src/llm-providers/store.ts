// src/llm-providers/store.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmAdminRoles, llmProviders, type LlmProviderRow } from '../db/schema.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload } from '../secret-payload-crypto.js'
import {
  LLM_PROVIDER_TYPES,
  VERIFICATION_STATUSES,
  type LlmProviderAccount,
  type LlmProviderType,
  type LlmRoleBindings,
  type Verification,
} from './types.js'

const log = logger.child({ scope: 'llm-providers:store' })

const LEGACY_PREFIX = 'legacy:'
const newProviderId = (): string => `prov_${crypto.randomUUID()}`

export type NewLlmProviderInput = {
  readonly label: string
  readonly providerType: LlmProviderType
  readonly baseUrl: string
  readonly apiKey: string
}

const isLlmProviderType = (value: string): value is LlmProviderType =>
  LLM_PROVIDER_TYPES.some((candidate) => candidate === value)

const isVerificationStatus = (value: string): value is Verification['status'] =>
  VERIFICATION_STATUSES.some((candidate) => candidate === value)

const parseModelsCache = (raw: string): string[] => {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((entry): entry is string => typeof entry === 'string')
}

const encryptApiKey = (apiKey: string): string => encryptSecretPayload({ apiKey })
const decryptApiKey = (stored: string): string => {
  if (stored.startsWith(LEGACY_PREFIX)) return stored.slice(LEGACY_PREFIX.length)
  const payload = decryptSecretPayload(stored)
  return payload['apiKey'] ?? ''
}

const toAccount = (row: LlmProviderRow): LlmProviderAccount => ({
  id: row.id,
  label: row.label,
  providerType: isLlmProviderType(row.providerType) ? row.providerType : 'custom',
  baseUrl: row.baseUrl,
  apiKey: decryptApiKey(row.encryptedApiKey),
  verification: {
    status: isVerificationStatus(row.verificationStatus) ? row.verificationStatus : 'unverified',
    error: row.verificationError,
    at: row.verificationAt,
    models: row.modelsCache === null ? [] : parseModelsCache(row.modelsCache),
    modelsFetchedAt: row.modelsFetchedAt,
  },
})

// ---- in-process cache (mirrors src/system-config.ts cache) ----
const cache = new Map<string, LlmProviderAccount>()
let roleCache: LlmRoleBindings | null | undefined = undefined
let cachePrimed = false

export const clearLlmAdminCacheForTesting = (): void => {
  cache.clear()
  cachePrimed = false
  roleCache = undefined
}

export const primeLlmAdminCache = (): void => {
  const rows = getDrizzleDb().select().from(llmProviders).all()
  cache.clear()
  cachePrimed = true
  for (const row of rows) cache.set(row.id, toAccount(row))
  roleCache = readRoleBindings()
  log.debug({ count: rows.length }, 'llm_providers cache primed')
}

const ensureCache = (): void => {
  if (cachePrimed) return
  const rows = getDrizzleDb().select().from(llmProviders).all()
  cachePrimed = true
  for (const row of rows) cache.set(row.id, toAccount(row))
}

export function listLlmProviders(): LlmProviderAccount[] {
  ensureCache()
  return [...cache.values()]
}

export function getLlmProvider(id: string): LlmProviderAccount | null {
  ensureCache()
  return cache.get(id) ?? null
}

export function createLlmProvider(input: NewLlmProviderInput, updatedBy: string): LlmProviderAccount {
  const id = newProviderId()
  const now = Date.now()
  getDrizzleDb()
    .insert(llmProviders)
    .values({
      id,
      label: input.label,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      encryptedApiKey: encryptApiKey(input.apiKey),
      modelsCache: null,
      modelsFetchedAt: null,
      verificationStatus: 'unverified',
      verificationError: null,
      verificationAt: null,
      createdAt: now,
      updatedAt: now,
      updatedBy,
    })
    .run()
  const row = getDrizzleDb().select().from(llmProviders).where(eq(llmProviders.id, id)).get()
  if (row === undefined) {
    throw new Error(`LLM provider disappeared immediately after insert: ${id}`)
  }
  const account = toAccount(row)
  cache.set(id, account)
  log.info({ id, label: input.label }, 'LLM provider created')
  return account
}

export function updateLlmProvider(
  id: string,
  patch: Partial<{ label: string; providerType: LlmProviderType; baseUrl: string; apiKey: string }>,
  updatedBy: string,
): LlmProviderAccount | null {
  const current = getLlmProvider(id)
  if (current === null) return null
  const now = Date.now()
  const set: Partial<typeof llmProviders.$inferInsert> = { updatedAt: now, updatedBy }
  if (patch.label !== undefined) set.label = patch.label
  if (patch.providerType !== undefined) set.providerType = patch.providerType
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl
  if (patch.apiKey !== undefined) set.encryptedApiKey = encryptApiKey(patch.apiKey)
  getDrizzleDb().update(llmProviders).set(set).where(eq(llmProviders.id, id)).run()
  const fresh = getDrizzleDb().select().from(llmProviders).where(eq(llmProviders.id, id)).get()
  if (fresh === undefined) return null
  const account = toAccount(fresh)
  cache.set(id, account)
  return account
}

export function updateProviderVerification(id: string, verification: Verification): void {
  getDrizzleDb()
    .update(llmProviders)
    .set({
      verificationStatus: verification.status,
      verificationError: verification.error,
      verificationAt: verification.at,
      modelsCache: JSON.stringify(verification.models),
      modelsFetchedAt: verification.modelsFetchedAt,
      updatedAt: Date.now(),
    })
    .where(eq(llmProviders.id, id))
    .run()
  const fresh = getDrizzleDb().select().from(llmProviders).where(eq(llmProviders.id, id)).get()
  if (fresh !== undefined) cache.set(id, toAccount(fresh))
}

export function deleteLlmProvider(id: string): void {
  const roles = getAdminRoleBindings()
  if (roles !== null && roles.main.providerId === id) {
    throw new Error('cannot delete the provider bound to main; reassign main first')
  }
  getDrizzleDb().delete(llmProviders).where(eq(llmProviders.id, id)).run()
  cache.delete(id)
  if (roles !== null && (roles.small?.providerId === id || roles.embedding?.providerId === id)) {
    const next: LlmRoleBindings = {
      main: roles.main,
      small: roles.small?.providerId === id ? null : roles.small,
      embedding: roles.embedding?.providerId === id ? null : roles.embedding,
    }
    setAdminRoleBindings(next, 'system:delete-provider')
  }
  log.info({ id }, 'LLM provider deleted')
}

const readRoleBindings = (): LlmRoleBindings | null => {
  const row = getDrizzleDb().select().from(llmAdminRoles).where(eq(llmAdminRoles.id, 1)).get()
  if (row === undefined) return null
  const small =
    row.smallProviderId === null || row.smallModel === null
      ? null
      : { providerId: row.smallProviderId, model: row.smallModel }
  const embedding =
    row.embeddingProviderId === null || row.embeddingModel === null
      ? null
      : { providerId: row.embeddingProviderId, model: row.embeddingModel }
  return {
    main: { providerId: row.mainProviderId, model: row.mainModel },
    small,
    embedding,
  }
}

export function getAdminRoleBindings(): LlmRoleBindings | null {
  if (roleCache === undefined) roleCache = readRoleBindings()
  return roleCache
}

export function setAdminRoleBindings(bindings: LlmRoleBindings, updatedBy: string): void {
  const now = Date.now()
  getDrizzleDb()
    .insert(llmAdminRoles)
    .values({
      id: 1,
      mainProviderId: bindings.main.providerId,
      mainModel: bindings.main.model,
      smallProviderId: bindings.small?.providerId ?? null,
      smallModel: bindings.small?.model ?? null,
      embeddingProviderId: bindings.embedding?.providerId ?? null,
      embeddingModel: bindings.embedding?.model ?? null,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: llmAdminRoles.id,
      set: {
        mainProviderId: bindings.main.providerId,
        mainModel: bindings.main.model,
        smallProviderId: bindings.small?.providerId ?? null,
        smallModel: bindings.small?.model ?? null,
        embeddingProviderId: bindings.embedding?.providerId ?? null,
        embeddingModel: bindings.embedding?.model ?? null,
        updatedAt: now,
        updatedBy,
      },
    })
    .run()
  roleCache = readRoleBindings()
  log.info({ updatedBy }, 'admin LLM role bindings set')
}
