// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProviderTraits } from './types.js'

/** A config key required by this chat provider. */
export type ChatProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
}

export type ChatProviderConfigField = {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  scope: 'instance' | 'context'
}

export type ChatProviderDescriptor = {
  type: string
  displayName: string
  source: 'builtin' | { plugin: string }
  instanceConfigSchema: readonly ChatProviderConfigField[]
  contextConfigSchema: readonly ChatProviderConfigField[]
  capabilities: ReadonlySet<ChatCapability>
  traits: ChatProviderTraits
}
