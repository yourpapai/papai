// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import type { z } from 'zod'

import { YouTrackClassifiedError } from './classify-error.js'
import { capAllowedValues, classifyFieldType, normalize } from './field-engine.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

export type DedicatedKind = 'state' | 'user' | 'priority' | 'date'

const CANONICAL_NAMES: Record<DedicatedKind, readonly string[]> = {
  state: ['state', 'статус'],
  user: ['assignee', 'ответственный'],
  priority: ['priority', 'приоритет'],
  date: ['due date', 'дедлайн'],
}

const matchesType = (field: Readonly<ProjectCustomField>, kind: DedicatedKind): boolean => {
  const c = classifyFieldType(field)
  if (kind === 'state') return c.label === 'state'
  if (kind === 'priority') return c.label === 'enum'
  if (kind === 'user') return c.kind === 'user'
  return c.kind === 'date'
}

const matchesCanonicalName = (field: Readonly<ProjectCustomField>, names: readonly string[]): boolean => {
  const name = field.field?.name
  const localized = field.field?.localizedName ?? undefined
  return (
    (name !== undefined && names.includes(normalize(name))) ||
    (localized !== undefined && localized !== null && names.includes(normalize(localized)))
  )
}

const fieldName = (field: Readonly<ProjectCustomField>): string => field.field?.name ?? '(unnamed)'

const dedicatedError = (kind: DedicatedKind, candidates: readonly ProjectCustomField[]): YouTrackClassifiedError => {
  const names = capAllowedValues(candidates.map(fieldName)).join('; ')
  const detail =
    candidates.length === 0
      ? `No ${kind}-type field exists in this project. Use describe_project to see the fields, then set the value via customFields by name.`
      : `Multiple candidate fields for "${kind}" (${names}). Set the intended one explicitly via customFields by name.`
  return new YouTrackClassifiedError(detail, providerError.validationFailed('customFields', detail))
}

/**
 * Resolve a dedicated param (status/assignee/priority/dueDate) to the project's real field by
 * type. Unique → use it. Ambiguous → disambiguate by canonical name; still ambiguous → teaching
 * error. `priority` always requires a canonical name match because enum fields are non-unique.
 */
export const resolveDedicatedField = (
  kind: DedicatedKind,
  projectFields: readonly ProjectCustomField[],
): ProjectCustomField => {
  const candidates = projectFields.filter((f) => f.field?.name !== undefined && matchesType(f, kind))
  if (kind !== 'priority' && candidates.length === 1) {
    const only = candidates[0]
    if (only !== undefined) return only
  }
  const named = candidates.filter((f) => matchesCanonicalName(f, CANONICAL_NAMES[kind]))
  const pick = named[0]
  if (named.length === 1 && pick !== undefined) return pick
  throw dedicatedError(kind, candidates)
}
