// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  providerType: text('provider_type').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  baseProvider: text('base_provider'),
  baseModel: text('base_model'),
  modelsCache: text('models_cache'),
  modelsFetchedAt: integer('models_fetched_at'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  verificationError: text('verification_error'),
  verificationAt: integer('verification_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
})

export type LlmProviderRow = typeof llmProviders.$inferSelect

export const llmAdminRoles = sqliteTable('llm_admin_roles', {
  id: integer('id').primaryKey(),
  mainProviderId: text('main_provider_id').notNull(),
  mainModel: text('main_model').notNull(),
  smallProviderId: text('small_provider_id'),
  smallModel: text('small_model'),
  embeddingProviderId: text('embedding_provider_id'),
  embeddingModel: text('embedding_model'),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
})

export type LlmAdminRoleRow = typeof llmAdminRoles.$inferSelect
