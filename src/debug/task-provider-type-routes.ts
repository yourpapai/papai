// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  getTaskProviderConfigValidator,
  listTaskProviderTypes,
  type TaskProviderTypeDescriptor,
} from '../providers/registry.js'
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
  configSchema: descriptor.configSchema
    .filter((field) => (field.scope ?? 'instance') === 'instance')
    .map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      sensitive: field.sensitive ?? false,
    })),
  capabilities: [...descriptor.capabilities],
  source: descriptor.source,
})

/** Run the optional provider config validator. Returns a 400 Response on failure, null on success or no validator. */
export const validateTaskInstanceConfig = async (
  type: string,
  config: Record<string, string>,
): Promise<Response | null> => {
  const validator = getTaskProviderConfigValidator(type)
  if (validator === undefined) return null
  const result = await validator(config)
  if (result.ok) return null
  return jsonResponse({ error: 'invalid_task_instance_config', reason: result.reason }, { status: 400 })
}

export const handleTaskProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/task-provider-types' && req.method === 'GET') {
    return jsonResponse(listTaskProviderTypes().map((descriptor) => taskProviderTypeView(descriptor)))
  }
  return null
}
