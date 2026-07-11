// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { shapeUser } from './format-shapers.js'
import type { ShapedUser } from './format-shapers.js'

export interface ShapedAttachment {
  id?: string
  name?: string
  size?: number
  mimeType?: string
  url?: string
  author?: ShapedUser
  created?: number
}

export interface ShapedComment {
  id?: string
  text?: string
  created?: number
  updated?: number
  author?: ShapedUser
  attachments?: ShapedAttachment[]
}

export interface ShapedActivityField {
  name?: string
}

export interface ShapedActivityTarget {
  idReadable?: string
}

export interface ShapedActivity {
  timestamp?: number
  field?: ShapedActivityField
  added?: ShapedActivityField[]
  removed?: ShapedActivityField[]
  target?: ShapedActivityTarget
}

export interface ShapedFieldOption {
  name?: string
  type?: string
  values?: string[]
  free?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function shapeAttachment(raw: unknown): ShapedAttachment {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const name = stringOr(raw['name'])
  const size = numberOr(raw['size'])
  const mimeType = stringOr(raw['mimeType'])
  const url = stringOr(raw['url'])
  const author = shapeUser(raw['author'])
  const created = numberOr(raw['created'])
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(size === undefined ? {} : { size }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(url === undefined ? {} : { url }),
    ...(author === undefined ? {} : { author }),
    ...(created === undefined ? {} : { created }),
  }
}

export function shapeComment(raw: unknown): ShapedComment {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const text = stringOr(raw['text'])
  const created = numberOr(raw['created'])
  const updated = numberOr(raw['updated'])
  const author = shapeUser(raw['author'])
  const attachmentsRaw = raw['attachments']
  const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw.map((entry) => shapeAttachment(entry)) : undefined
  return {
    ...(id === undefined ? {} : { id }),
    ...(text === undefined ? {} : { text }),
    ...(created === undefined ? {} : { created }),
    ...(updated === undefined ? {} : { updated }),
    ...(author === undefined ? {} : { author }),
    ...(attachments === undefined ? {} : { attachments }),
  }
}

function shapeActivityField(raw: unknown): ShapedActivityField {
  if (!isRecord(raw)) return {}
  const name = stringOr(raw['name'])
  return {
    ...(name === undefined ? {} : { name }),
  }
}

export function shapeActivity(raw: unknown): ShapedActivity {
  if (!isRecord(raw)) return {}
  const timestamp = numberOr(raw['timestamp'])
  const field = isRecord(raw['field']) ? shapeActivityField(raw['field']) : undefined
  const addedRaw = raw['added']
  const added = Array.isArray(addedRaw) ? addedRaw.map((entry) => shapeActivityField(entry)) : undefined
  const removedRaw = raw['removed']
  const removed = Array.isArray(removedRaw) ? removedRaw.map((entry) => shapeActivityField(entry)) : undefined
  const targetRaw = raw['target']
  const target = isRecord(targetRaw) ? { idReadable: stringOr(targetRaw['idReadable']) } : undefined

  return {
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(field === undefined ? {} : { field }),
    ...(added === undefined ? {} : { added }),
    ...(removed === undefined ? {} : { removed }),
    ...(target === undefined ? {} : { target }),
  }
}

function shapeFieldOption(raw: unknown): ShapedFieldOption | undefined {
  if (!isRecord(raw)) return undefined
  const name = stringOr(raw['name'])
  const type = stringOr(raw['$type'])
  const projectCustomField = raw['projectCustomField']
  const bundle = isRecord(projectCustomField) ? projectCustomField['bundle'] : undefined
  const values = isRecord(bundle) ? bundle['values'] : undefined

  if (Array.isArray(values)) {
    const optionValues = values
      .map((entry) => stringOr(isRecord(entry) ? entry['name'] : undefined))
      .filter((entry): entry is string => entry !== undefined)
    return {
      ...(name === undefined ? {} : { name }),
      ...(type === undefined ? {} : { type }),
      values: optionValues,
    }
  }

  return {
    ...(name === undefined ? {} : { name }),
    ...(type === undefined ? {} : { type }),
    free: true,
  }
}

export function shapeFieldOptions(issueRaw: unknown, fieldName?: string): ShapedFieldOption[] {
  if (!isRecord(issueRaw)) return []
  const customFieldsRaw = issueRaw['customFields']
  if (!Array.isArray(customFieldsRaw)) return []

  const options = customFieldsRaw
    .map((entry) => shapeFieldOption(entry))
    .filter((entry): entry is ShapedFieldOption => entry !== undefined)

  if (fieldName === undefined) return options

  const needle = fieldName.toLowerCase()
  return options.filter((entry) => entry.name?.toLowerCase() === needle)
}
