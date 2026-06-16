// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { DedicatedKind } from './dedicated-fields.js'
import { resolveDedicatedField } from './dedicated-fields.js'
import { unknownFieldError } from './field-name-error.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
type NamedProjectCustomField = ProjectCustomField & { readonly field: { readonly name: string } }

export type FieldPair =
  | { source: 'dedicated'; kind: DedicatedKind; value: string }
  | { source: 'generic'; name: string; value: string }

export type ResolvedFieldPair = { field: ProjectCustomField; value: string }

type DedicatedParams = Readonly<{
  status?: string
  priority?: string
  dueDate?: string
  assignee?: string
  customFields?: ReadonlyArray<{ name: string; value: string }>
}>

/** Collects dedicated params (tagged by field kind) and generic customFields into a flat list. */
export const collectFieldPairs = (params: DedicatedParams): FieldPair[] => {
  const pairs: FieldPair[] = []
  if (params.status !== undefined) pairs.push({ source: 'dedicated', kind: 'state', value: params.status })
  if (params.priority !== undefined) pairs.push({ source: 'dedicated', kind: 'priority', value: params.priority })
  if (params.assignee !== undefined) pairs.push({ source: 'dedicated', kind: 'user', value: params.assignee })
  if (params.dueDate !== undefined) pairs.push({ source: 'dedicated', kind: 'date', value: params.dueDate })
  for (const cf of params.customFields ?? []) pairs.push({ source: 'generic', name: cf.name, value: cf.value })
  return pairs
}

/** Resolves a pair to a concrete project field: dedicated by type, generic by name. */
export const resolveFieldPair = (
  pair: Readonly<FieldPair>,
  projectFieldsByName: ReadonlyMap<string, NamedProjectCustomField>,
  op: 'create' | 'update',
): ResolvedFieldPair => {
  if (pair.source === 'generic') {
    const field = projectFieldsByName.get(pair.name)
    if (field === undefined) throw unknownFieldError(pair.name, [...projectFieldsByName.keys()], op)
    return { field, value: pair.value }
  }
  const field = resolveDedicatedField(pair.kind, [...projectFieldsByName.values()])
  return { field, value: pair.value }
}
