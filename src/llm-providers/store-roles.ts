// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmAdminRoles } from '../db/schema.js'
import { logger } from '../logger.js'
import type { LlmRoleBindings } from './types.js'

const log = logger.child({ scope: 'llm-providers:store-roles' })

let roleCache: LlmRoleBindings | null | undefined = undefined

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

export const clearRoleBindingsCacheForTesting = (): void => {
  roleCache = undefined
}
