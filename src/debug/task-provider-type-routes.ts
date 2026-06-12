// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskProviderTypes, type TaskProviderTypeDescriptor } from '../providers/registry.js'
import type { ProviderConfigField } from '../providers/types.js'
import { jsonResponse } from './json-response.js'

export type ProviderConfigFieldView = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly storageKey?: string
}

export type TaskProviderTypeView = {
  readonly type: string
  readonly displayName: string
  readonly instanceConfigSchema: readonly ProviderConfigFieldView[]
  readonly contextConfigSchema: readonly ProviderConfigFieldView[]
  readonly capabilities: readonly string[]
  readonly traits: readonly string[]
  readonly source: 'builtin' | { readonly plugin: string }
}

const fieldView = (field: ProviderConfigField): ProviderConfigFieldView => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  ...(field.storageKey === undefined ? {} : { storageKey: field.storageKey }),
})

const taskProviderTypeView = (descriptor: TaskProviderTypeDescriptor): TaskProviderTypeView => ({
  type: descriptor.type,
  displayName: descriptor.displayName,
  instanceConfigSchema: descriptor.instanceConfigSchema.map((field) => fieldView(field)),
  contextConfigSchema: descriptor.contextConfigSchema.map((field) => fieldView(field)),
  capabilities: [...descriptor.capabilities],
  traits: [...descriptor.traits],
  source: descriptor.source,
})

export const handleTaskProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/task-provider-types' && req.method === 'GET') {
    return jsonResponse(listTaskProviderTypes().map((descriptor) => taskProviderTypeView(descriptor)))
  }
  return null
}
