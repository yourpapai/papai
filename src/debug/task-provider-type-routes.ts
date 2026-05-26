// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskProviderTypes, type TaskProviderTypeDescriptor } from '../providers/registry.js'

const taskProviderTypeView = (
  descriptor: TaskProviderTypeDescriptor,
): {
  readonly type: string
  readonly displayName: string
  readonly configSchema: readonly { key: string; label: string; required: boolean; sensitive: boolean }[]
  readonly capabilities: readonly string[]
  readonly source: 'builtin' | { readonly plugin: string }
} => ({
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

const jsonResponse = (body: unknown, ...args: [] | [ResponseInit]): Response => {
  if (args.length === 0) {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }
  const init = args[0]
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const handleTaskProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/task-provider-types' && req.method === 'GET') {
    return jsonResponse(listTaskProviderTypes().map((descriptor) => taskProviderTypeView(descriptor)))
  }
  return null
}
