// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import type { z } from 'zod'

import { YouTrackClassifiedError } from './classify-error.js'
import { YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import { parseDueDateValue } from './due-date.js'
import type { IssueCustomFieldPayload } from './field-engine.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

type StandardCustomFieldPayload = {
  name: string
  $type: string
  value: Record<string, string> | number
}

export type ResolvedCreateFieldPayload =
  | { kind: 'legacy'; payload: StandardCustomFieldPayload | IssueCustomFieldPayload }
  | { kind: 'engine'; field: ProjectCustomField; value: string }

export const legacyDedicatedPayload = (
  name: string,
  value: string,
): StandardCustomFieldPayload | IssueCustomFieldPayload | undefined => {
  switch (name) {
    case 'State':
      return { name, $type: 'StateIssueCustomField', value: { name: value } }
    case 'Priority':
      return { name, $type: 'SingleEnumIssueCustomField', value: { name: value } }
    case 'Assignee':
      return { name, $type: 'SingleUserIssueCustomField', value: { login: value } }
    case YOUTRACK_DUE_DATE_FIELD_NAME:
      return { name, $type: 'DateIssueCustomField', value: parseDueDateValue(value) }
    default:
      return undefined
  }
}

type CreateFieldPair = { name: string; value: string; dedicated: boolean }

export const collectCreateFieldPairs = (
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
): CreateFieldPair[] => {
  const pairs: CreateFieldPair[] = []
  if (params.status !== undefined) pairs.push({ name: 'State', value: params.status, dedicated: true })
  if (params.priority !== undefined) pairs.push({ name: 'Priority', value: params.priority, dedicated: true })
  if (params.assignee !== undefined) pairs.push({ name: 'Assignee', value: params.assignee, dedicated: true })
  if (params.dueDate !== undefined)
    pairs.push({ name: YOUTRACK_DUE_DATE_FIELD_NAME, value: params.dueDate, dedicated: true })
  for (const cf of params.customFields ?? []) pairs.push({ name: cf.name, value: cf.value, dedicated: false })
  return pairs
}

export const resolveCreateFieldPair = (
  pair: Readonly<CreateFieldPair>,
  projectFieldsByName: ReadonlyMap<string, ProjectCustomField & { readonly field: { readonly name: string } }>,
): ResolvedCreateFieldPayload => {
  const field = projectFieldsByName.get(pair.name)
  if (field !== undefined) return { kind: 'engine', field, value: pair.value }
  const legacy = pair.dedicated ? legacyDedicatedPayload(pair.name, pair.value) : undefined
  if (legacy !== undefined) return { kind: 'legacy', payload: legacy }
  throw new YouTrackClassifiedError(
    `Unknown custom field for create: ${pair.name}`,
    providerError.validationFailed(
      'customFields',
      `${pair.name} is not a known project field for this YouTrack project`,
    ),
  )
}
