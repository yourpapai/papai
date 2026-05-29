// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import type { InstanceConfig } from '../instances/types.js'
import {
  validateTaskInstanceConfigResult,
  type TaskInstanceConfigValidationFailure,
} from '../providers/config-validation.js'
import { jsonResponse } from './json-response.js'

type InstanceConfigField = {
  readonly key: string
  readonly required: boolean
}

type InstanceConfigValidationError = {
  readonly missing: readonly string[]
  readonly invalidUrls: readonly string[]
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

const validateDescriptorConfig = (
  fields: readonly InstanceConfigField[],
  config: InstanceConfig,
): InstanceConfigValidationError => {
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

const validationResponse = (
  error: 'invalid_platform_instance_config' | 'invalid_task_instance_config',
  type: string,
  result: InstanceConfigValidationError,
): Response | null => {
  if (result.missing.length === 0 && result.invalidUrls.length === 0) return null
  return jsonResponse(
    {
      error,
      type,
      ...(result.missing.length === 0 ? {} : { missing: result.missing }),
      ...(result.invalidUrls.length === 0 ? {} : { invalidUrls: result.invalidUrls }),
    },
    { status: 400 },
  )
}

export const validatePlatformInstanceConfig = (type: string, config: InstanceConfig): Response | null => {
  const descriptor = listPlatformProviderTypes().find((candidate) => candidate.type === type)
  if (descriptor === undefined) {
    return jsonResponse({ error: 'unknown_platform_provider_type', type }, { status: 400 })
  }
  return validationResponse(
    'invalid_platform_instance_config',
    type,
    validateDescriptorConfig(descriptor.instanceConfigSchema, config),
  )
}

const taskInstanceConfigValidationResponse = (failure: TaskInstanceConfigValidationFailure): Response => {
  if (failure.kind === 'unknown_task_provider') {
    return jsonResponse({ error: 'unknown_task_provider_type', type: failure.type }, { status: 400 })
  }
  if (
    failure.kind === 'task_provider_config_validator_rejected' ||
    failure.kind === 'task_provider_config_validator_failed'
  ) {
    return jsonResponse(
      { error: 'invalid_task_instance_config', type: failure.type, reason: failure.reason },
      { status: 400 },
    )
  }
  return jsonResponse(
    {
      error: 'invalid_task_instance_config',
      type: failure.type,
      ...(failure.missing.length === 0 ? {} : { missing: failure.missing }),
      ...(failure.invalidUrls.length === 0 ? {} : { invalidUrls: failure.invalidUrls }),
    },
    { status: 400 },
  )
}

export const validateTaskInstanceRouteConfig = (type: string, config: InstanceConfig): Promise<Response | null> =>
  validateTaskInstanceConfigResult(type, config).then((failure) =>
    failure === null ? null : taskInstanceConfigValidationResponse(failure),
  )
