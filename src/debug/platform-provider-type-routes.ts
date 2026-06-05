// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import type { ChatProviderConfigField, ChatProviderDescriptor, ChatProviderTraits } from '../chat/types.js'
import { jsonResponse } from './json-response.js'

export type PlatformProviderConfigFieldView = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
}

export type PlatformProviderTypeView = {
  readonly type: string
  readonly displayName: string
  readonly instanceConfigSchema: readonly PlatformProviderConfigFieldView[]
  readonly contextConfigSchema: readonly PlatformProviderConfigFieldView[]
  readonly capabilities: readonly string[]
  readonly traits: ChatProviderTraits
  readonly source: string
}

const fieldView = (field: ChatProviderConfigField): PlatformProviderConfigFieldView => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
})

const platformProviderTypeView = (descriptor: ChatProviderDescriptor): PlatformProviderTypeView => ({
  type: descriptor.type,
  displayName: descriptor.displayName,
  instanceConfigSchema: descriptor.instanceConfigSchema.map((field) => fieldView(field)),
  contextConfigSchema: descriptor.contextConfigSchema.map((field) => fieldView(field)),
  capabilities: [...descriptor.capabilities],
  traits: descriptor.traits,
  source: descriptor.source === 'builtin' ? 'builtin' : descriptor.source.plugin,
})

export const handlePlatformProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/platform-provider-types' && req.method === 'GET') {
    return jsonResponse(listPlatformProviderTypes().map((descriptor) => platformProviderTypeView(descriptor)))
  }
  return null
}
