// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { codingSessionCredentials, type CodingSessionCredentialRow } from '../db/coding-credentials-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload, type SecretPayload } from '../secret-payload-crypto.js'
import {
  type CodingCredentialConfig,
  type CodingCredentialState,
  type CodingNamespace,
  FIELDS_BY_NAMESPACE,
  REQUIRED_BY_NAMESPACE,
} from './types.js'

const log = logger.child({ scope: 'coding-credentials:store' })
const UNREADABLE = 'stored coding credentials are unreadable'

const now = (): number => Date.now()

const allRequiredFields = (namespace: CodingNamespace): readonly string[] => [...REQUIRED_BY_NAMESPACE[namespace]]

const cleanConfig = (namespace: CodingNamespace, input: CodingCredentialConfig): CodingCredentialConfig =>
  Object.fromEntries(
    FIELDS_BY_NAMESPACE[namespace].flatMap((key) => {
      const value = (input as Record<string, string | undefined>)[key]?.trim()
      return value === undefined || value.length === 0 ? [] : [[key, value]]
    }),
  )

const findRow = (contextId: string, namespace: CodingNamespace): CodingSessionCredentialRow | undefined =>
  getDrizzleDb()
    .select()
    .from(codingSessionCredentials)
    .where(and(eq(codingSessionCredentials.contextId, contextId), eq(codingSessionCredentials.namespace, namespace)))
    .get()

const decrypt = (contextId: string, blob: string): CodingCredentialConfig | 'unreadable' => {
  try {
    return decryptSecretPayload(blob) as CodingCredentialConfig
  } catch {
    log.warn({ contextId }, UNREADABLE)
    return 'unreadable'
  }
}

const missingRequired = (namespace: CodingNamespace, config: CodingCredentialConfig | null): readonly string[] =>
  REQUIRED_BY_NAMESPACE[namespace].filter((key) => {
    const value = (config as Record<string, string | undefined> | null)?.[key]?.trim()
    return value === undefined || value.length === 0
  })

export function getCodingCredentialState(contextId: string, namespace: CodingNamespace): CodingCredentialState {
  const row = findRow(contextId, namespace)
  if (row === undefined) {
    return { configured: false, complete: false, missing: allRequiredFields(namespace) }
  }
  const decrypted = decrypt(contextId, row.encryptedConfig)
  if (decrypted === 'unreadable') {
    return {
      configured: true,
      complete: false,
      missing: allRequiredFields(namespace),
      unreadable: true,
      error: UNREADABLE,
    }
  }
  const missing = missingRequired(namespace, decrypted)
  return { configured: true, complete: missing.length === 0, missing }
}

export function getCodingCredentials(contextId: string, namespace: CodingNamespace): CodingCredentialConfig | null {
  const row = findRow(contextId, namespace)
  if (row === undefined) return null
  const decrypted = decrypt(contextId, row.encryptedConfig)
  return decrypted === 'unreadable' ? null : cleanConfig(namespace, decrypted)
}

export function updateCodingCredentials(
  contextId: string,
  namespace: CodingNamespace,
  config: CodingCredentialConfig,
  updatedBy: string,
): void {
  const current = getCodingCredentials(contextId, namespace) ?? {}
  const merged: Record<string, string | undefined> = { ...current }
  for (const key of FIELDS_BY_NAMESPACE[namespace]) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue
    const value = (config as Record<string, string | undefined>)[key]?.trim() ?? ''
    merged[key] = value.length === 0 ? undefined : value
  }
  const cleaned = cleanConfig(namespace, merged)
  const encryptedConfig = encryptSecretPayload(cleaned as SecretPayload)
  getDrizzleDb()
    .insert(codingSessionCredentials)
    .values({ contextId, namespace, encryptedConfig, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: [codingSessionCredentials.contextId, codingSessionCredentials.namespace],
      set: {
        encryptedConfig: sql`excluded.encrypted_config`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
  log.info({ contextId, namespace, updatedBy }, 'coding credentials updated')
}

export function clearCodingCredentials(contextId: string, namespace: CodingNamespace, updatedBy: string): void {
  getDrizzleDb()
    .delete(codingSessionCredentials)
    .where(and(eq(codingSessionCredentials.contextId, contextId), eq(codingSessionCredentials.namespace, namespace)))
    .run()
  log.info({ contextId, namespace, updatedBy }, 'coding credentials cleared')
}
