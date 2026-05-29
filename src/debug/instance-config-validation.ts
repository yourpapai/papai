// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import type { InstanceConfig } from '../instances/types.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { jsonResponse } from './json-response.js'
import { validateTaskInstanceConfig } from './task-provider-type-routes.js'

type InstanceConfigField = {
  readonly key: string
  readonly required: boolean
}

type InstanceConfigValidationError = {
  readonly missing: readonly string[]
  readonly invalidUrls: readonly string[]
}

const pickInstanceScopedConfig = (type: string, config: InstanceConfig): InstanceConfig => {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return config
  return Object.fromEntries(
    descriptor.instanceConfigSchema
      .map((field) => {
        const value = config[field.key]
        if (value === undefined) return null
        return [field.key, value] as const
      })
      .filter((entry) => entry !== null),
  )
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

export const validateTaskDescriptorInstanceConfig = (type: string, config: InstanceConfig): Response | null => {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return jsonResponse({ error: 'unknown_task_provider_type', type }, { status: 400 })
  return validationResponse(
    'invalid_task_instance_config',
    type,
    validateDescriptorConfig(descriptor.instanceConfigSchema, config),
  )
}

export const validateTaskInstanceRouteConfig = (
  type: string,
  config: InstanceConfig,
): Response | Promise<Response | null> => {
  const descriptorConfigError = validateTaskDescriptorInstanceConfig(type, config)
  if (descriptorConfigError !== null) return descriptorConfigError
  return Promise.resolve(validateTaskInstanceConfig(type, pickInstanceScopedConfig(type, config))).then((response) => {
    if (response === null) return null
    if (response.status !== 400) return response
    return response
      .clone()
      .json()
      .then((body: unknown) => {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return response
        const responseBody = Object.fromEntries(Object.entries(body))
        if (responseBody['error'] !== 'invalid_task_instance_config') return response
        if ('type' in responseBody) return response
        return jsonResponse({ ...body, type }, { status: 400 })
      })
  })
}
