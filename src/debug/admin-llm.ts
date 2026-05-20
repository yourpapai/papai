// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import {
  listSystemConfigEntries,
  maskSystemConfigValue,
  setSystemConfig,
  SYSTEM_CONFIG_KEYS,
  type SystemConfigKey,
} from '../system-config.js'

const log = logger.child({ scope: 'debug:admin-llm' })

export type AdminLlmKeyState = {
  value: string | null
  updatedAt: number | null
  updatedBy: string | null
}

export type AdminLlmSnapshot = Record<SystemConfigKey, AdminLlmKeyState>

export type AdminLlmErrorKind = 'bad-key' | 'bad-value'

export class AdminLlmError extends Error {
  readonly kind: AdminLlmErrorKind
  constructor(kind: AdminLlmErrorKind, message: string) {
    super(message)
    this.name = 'AdminLlmError'
    this.kind = kind
  }
}

const emptyState = (): AdminLlmKeyState => ({ value: null, updatedAt: null, updatedBy: null })

export const getAdminLlmSnapshot = (): AdminLlmSnapshot => {
  log.debug('getAdminLlmSnapshot called')
  const snapshot: AdminLlmSnapshot = {
    llm_apikey: emptyState(),
    llm_baseurl: emptyState(),
    main_model: emptyState(),
    small_model: emptyState(),
    embedding_model: emptyState(),
  }
  for (const entry of listSystemConfigEntries()) {
    snapshot[entry.key] = {
      value: maskSystemConfigValue(entry.key, entry.value),
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
    }
  }
  return snapshot
}

const isSystemConfigKey = (value: unknown): value is SystemConfigKey =>
  typeof value === 'string' && (SYSTEM_CONFIG_KEYS as readonly string[]).includes(value)

const UpdateBodySchema = z.object({
  key: z.string().refine(isSystemConfigKey, { message: 'unknown system config key' }),
  value: z.string(),
})

export const applyAdminLlmUpdate = (body: unknown, updatedBy: string): { key: SystemConfigKey; updatedAt: number } => {
  log.debug({ updatedBy }, 'applyAdminLlmUpdate called')
  const parsed = UpdateBodySchema.safeParse(body)
  if (!parsed.success) {
    throw new AdminLlmError('bad-key', 'invalid body shape or unknown key')
  }
  const trimmed = parsed.data.value.trim()
  if (trimmed === '') {
    throw new AdminLlmError('bad-value', 'value must be a non-empty string')
  }
  const updatedAt = Date.now()
  setSystemConfig(parsed.data.key, trimmed, updatedBy)
  log.info({ key: parsed.data.key, updatedBy }, 'admin LLM key updated via dashboard')
  return { key: parsed.data.key, updatedAt }
}
