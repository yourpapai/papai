// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { InstanceConfig } from '../instances/types.js'
import {
  getTaskProviderConfigValidator,
  getTaskProviderDescriptor,
  type TaskProviderConfigValidator,
  type TaskProviderTypeDescriptor,
} from './registry.js'
import type { ProviderConfigField } from './types.js'

export type TaskInstanceConfigValidationFailure =
  | { readonly kind: 'unknown_task_provider'; readonly type: string }
  | {
      readonly kind: 'invalid_task_instance_config'
      readonly type: string
      readonly missing: readonly string[]
      readonly invalidUrls: readonly string[]
    }
  | { readonly kind: 'task_provider_config_validator_rejected'; readonly type: string; readonly reason: string }
  | { readonly kind: 'task_provider_config_validator_failed'; readonly type: string; readonly reason: string }

export type TaskInstanceConfigValidationDeps = Readonly<{
  getTaskProviderDescriptor: (type: string) => TaskProviderTypeDescriptor | undefined
  getTaskProviderConfigValidator: (type: string) => TaskProviderConfigValidator | undefined
}>

const defaultDeps: TaskInstanceConfigValidationDeps = {
  getTaskProviderDescriptor,
  getTaskProviderConfigValidator,
}

const isBlank = (value: string | undefined): boolean => {
  if (value === undefined) return true
  return value.trim() === ''
}

const isUrlField = (key: string): boolean => key.toLowerCase().endsWith('url')

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const validateDescriptorConfig = (
  fields: readonly ProviderConfigField[],
  config: InstanceConfig,
): Pick<
  Extract<TaskInstanceConfigValidationFailure, { kind: 'invalid_task_instance_config' }>,
  'missing' | 'invalidUrls'
> => {
  const missing = fields.filter((field) => field.required && isBlank(config[field.key])).map((field) => field.key)
  const invalidUrls = fields
    .filter((field) => isUrlField(field.key))
    .filter((field) => {
      const value = config[field.key]
      return value !== undefined && value.trim() !== '' && !isHttpUrl(value)
    })
    .map((field) => field.key)
  return { missing, invalidUrls }
}

export const validateTaskInstanceConfigResult = async (
  type: string,
  config: InstanceConfig,
  deps: TaskInstanceConfigValidationDeps = defaultDeps,
): Promise<TaskInstanceConfigValidationFailure | null> => {
  const descriptor = deps.getTaskProviderDescriptor(type)
  if (descriptor === undefined) return { kind: 'unknown_task_provider', type }

  const descriptorResult = validateDescriptorConfig(descriptor.instanceConfigSchema, config)
  if (descriptorResult.missing.length > 0 || descriptorResult.invalidUrls.length > 0) {
    return { kind: 'invalid_task_instance_config', type, ...descriptorResult }
  }

  const validator = deps.getTaskProviderConfigValidator(type)
  if (validator === undefined) return null
  const result = await Promise.resolve()
    .then(() => validator(config))
    .catch((error: unknown) => ({
      ok: false as const,
      reason: errorMessage(error),
      validatorFailed: true as const,
    }))
  if ('validatorFailed' in result) {
    return { kind: 'task_provider_config_validator_failed', type, reason: result.reason }
  }
  if (result.ok) return null
  return { kind: 'task_provider_config_validator_rejected', type, reason: result.reason }
}
