// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { llmAdminRoles, llmProviders } from '../../src/db/llm-providers-schema.js'

describe('llmProviders schema', () => {
  test('exposes the expected admin-provider columns', () => {
    expect(llmProviders.id).toBeDefined()
    expect(llmProviders.label).toBeDefined()
    expect(llmProviders.providerType).toBeDefined()
    expect(llmProviders.baseUrl).toBeDefined()
    expect(llmProviders.encryptedApiKey).toBeDefined()
    expect(llmProviders.baseProvider).toBeDefined()
    expect(llmProviders.baseModel).toBeDefined()
    expect(llmProviders.modelsCache).toBeDefined()
    expect(llmProviders.modelsFetchedAt).toBeDefined()
    expect(llmProviders.verificationStatus).toBeDefined()
    expect(llmProviders.verificationError).toBeDefined()
    expect(llmProviders.verificationAt).toBeDefined()
    expect(llmProviders.createdAt).toBeDefined()
    expect(llmProviders.updatedAt).toBeDefined()
    expect(llmProviders.updatedBy).toBeDefined()
  })
})

describe('llmAdminRoles schema', () => {
  test('exposes the expected admin-role columns', () => {
    expect(llmAdminRoles.id).toBeDefined()
    expect(llmAdminRoles.mainProviderId).toBeDefined()
    expect(llmAdminRoles.mainModel).toBeDefined()
    expect(llmAdminRoles.smallProviderId).toBeDefined()
    expect(llmAdminRoles.smallModel).toBeDefined()
    expect(llmAdminRoles.embeddingProviderId).toBeDefined()
    expect(llmAdminRoles.embeddingModel).toBeDefined()
    expect(llmAdminRoles.updatedAt).toBeDefined()
    expect(llmAdminRoles.updatedBy).toBeDefined()
  })
})
