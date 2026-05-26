// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskProviderTypes, type TaskProviderTypeDescriptor } from '../providers/registry.js'
import { jsonResponse } from './json-response.js'

export type TaskProviderTypeView = {
  readonly type: string
  readonly displayName: string
  readonly configSchema: readonly { key: string; label: string; required: boolean; sensitive: boolean }[]
  readonly capabilities: readonly string[]
  readonly source: 'builtin' | { readonly plugin: string }
}

const taskProviderTypeView = (descriptor: TaskProviderTypeDescriptor): TaskProviderTypeView => ({
  type: descriptor.type,
  displayName: descriptor.displayName,
  configSchema: descriptor.configSchema.map((field) => ({
    key: field.key,
    label: field.label,
    required: field.required,
    sensitive: field.sensitive ?? false,
  })),
  capabilities: [...descriptor.capabilities],
  source: descriptor.source,
})

export const handleTaskProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/task-provider-types' && req.method === 'GET') {
    return jsonResponse(listTaskProviderTypes().map((descriptor) => taskProviderTypeView(descriptor)))
  }
  return null
}
