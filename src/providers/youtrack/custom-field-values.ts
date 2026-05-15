// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { TaskCustomField } from '../types.js'
import { YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import type { CustomFieldValueSchema } from './schemas/custom-fields.js'

type AnyCustomField = z.infer<typeof CustomFieldValueSchema>

const nonGenericFieldNames = new Set(['State', 'Priority', 'Assignee', YOUTRACK_DUE_DATE_FIELD_NAME])
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const getStringProperty = (value: unknown, property: 'login' | 'name' | 'text'): string | undefined => {
  if (!isRecord(value)) return undefined
  const prop = value[property]
  return typeof prop === 'string' ? prop : undefined
}
const stringifyUnknownValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '[complex value]'
  } catch {
    return '[complex value]'
  }
}

const buildReadOnlyCustomFieldValue = (value: unknown): TaskCustomField['value'] => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  const textValue = getStringProperty(value, 'text')
  if (textValue !== undefined) return textValue
  const nameValue = getStringProperty(value, 'name')
  if (nameValue !== undefined) return nameValue
  const loginValue = getStringProperty(value, 'login')
  if (loginValue !== undefined) return loginValue
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) return undefined
        return typeof item === 'string' ? item : (getStringProperty(item, 'name') ?? getStringProperty(item, 'login'))
      })
      .filter((item): item is string => item !== undefined)
  }
  return stringifyUnknownValue(value)
}

export const mapReadOnlyCustomFields = (
  customFields: readonly AnyCustomField[] | undefined,
): TaskCustomField[] | undefined => {
  const mapped = (customFields ?? [])
    .filter((field) => !nonGenericFieldNames.has(field.name))
    .map((field) => ({ name: field.name, value: buildReadOnlyCustomFieldValue(field.value) }))

  return mapped.length === 0 ? undefined : mapped
}
