// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  getTaskProviderConfigValidator,
  listTaskProviderTypes,
  type TaskProviderTypeDescriptor,
} from '../providers/registry.js'
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

const providerConfigValidatorResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.string() }),
])

const INVALID_PROVIDER_CONFIG_VALIDATOR_RESULT_REASON =
  'provider config validator returned an invalid result; expected { ok: true } or { ok: false, reason: string }'

/** Run the optional provider config validator. Returns a 400 Response on failure, null on success or no validator. */
export const validateTaskInstanceConfig = async (
  type: string,
  config: Record<string, string>,
): Promise<Response | null> => {
  const validator = getTaskProviderConfigValidator(type)
  if (validator === undefined) return null
  const result = await Promise.resolve()
    .then(() => validator(config))
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      return { ok: false as const, reason }
    })
  const parsedResult = providerConfigValidatorResultSchema.safeParse(result)
  if (!parsedResult.success) {
    return jsonResponse(
      {
        error: 'invalid_task_instance_config',
        type,
        reason: INVALID_PROVIDER_CONFIG_VALIDATOR_RESULT_REASON,
      },
      { status: 400 },
    )
  }
  if (parsedResult.data.ok) return null
  return jsonResponse(
    { error: 'invalid_task_instance_config', type, reason: parsedResult.data.reason },
    { status: 400 },
  )
}

export const handleTaskProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/task-provider-types' && req.method === 'GET') {
    return jsonResponse(listTaskProviderTypes().map((descriptor) => taskProviderTypeView(descriptor)))
  }
  return null
}
