// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Task } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
import type { z } from 'zod'

import { logger } from '../../src/logger.js'
import { makeBundleElementFetcher } from './bundle-values.js'
import { YouTrackClassifiedError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { PROJECT_CUSTOM_FIELD_FIELDS, YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import { collectFieldPairs, resolveFieldPair } from './create-field-helpers.js'
import { resolveDedicatedField } from './dedicated-fields.js'
import { DueDateCustomFieldSchema, mapYouTrackDueDateValue } from './due-date.js'
import { classifyFieldType, formatAllowed, resolveCustomFieldValue } from './field-engine.js'
import type { IssueCustomFieldPayload } from './field-engine.js'
import { unknownFieldError } from './field-name-error.js'
import { paginate } from './helpers.js'
import { fetchProjectCustomFieldsViaIssue } from './issue-derived-fields.js'
import { ProjectCustomFieldListSchema, ProjectCustomFieldSchema } from './schemas/bundle.js'

const log = logger.child({ scope: 'provider:youtrack:custom-fields' })

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
type NamedProjectCustomField = ProjectCustomField & { readonly field: { readonly name: string } }

type CustomFieldParams = Readonly<{
  status?: string
  priority?: string
  dueDate?: string
  assignee?: string
  customFields?: Array<{ name: string; value: string }>
}>

export const fetchProjectCustomFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  opts?: Readonly<{ deriveFromIssueWhenEmpty?: boolean; shortName?: string }>,
): Promise<ProjectCustomField[]> => {
  const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`, {
    query: { fields: PROJECT_CUSTOM_FIELD_FIELDS },
  })
  const fields = ProjectCustomFieldListSchema.parse(raw)
  if (fields.length > 0 || opts?.deriveFromIssueWhenEmpty !== true) {
    log.debug(
      { projectId, count: fields.length, fieldNames: fields.map((f) => f.field?.name ?? '(unnamed)'), source: 'admin' },
      'Fetched project custom fields',
    )
    return fields
  }
  // The admin endpoint answers 200 with [] when the token cannot read project field-settings.
  // Derive the schema from a sample issue, which exposes the same settings to any issue reader.
  log.warn(
    { projectId },
    'Admin customFields endpoint returned empty; deriving schema from a sample issue (token likely lacks field-settings read permission)',
  )
  return fetchProjectCustomFieldsViaIssue(config, projectId, opts.shortName)
}

const buildProjectFieldsByName = (
  projectCustomFields: readonly ProjectCustomField[],
): Map<string, NamedProjectCustomField> =>
  new Map(
    projectCustomFields
      .filter((field): field is NamedProjectCustomField => field.field?.name !== undefined)
      .map((field) => [field.field.name, field] as const),
  )

const buildHandledFieldSet = (
  projectFieldsByName: ReadonlyMap<string, NamedProjectCustomField>,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Set<string> => {
  const handledFields = new Set<string>()
  for (const fieldName of new Set((customFields ?? []).map((field) => field.name))) {
    if (!projectFieldsByName.has(fieldName)) {
      throw unknownFieldError(fieldName, [...projectFieldsByName.keys()], 'create')
    }
    handledFields.add(fieldName)
  }
  return handledFields
}

type RequiredFieldDescriptor = { name: string; label: string }

const describeRequiredField = async (
  field: ProjectCustomField,
  fetchElements: (segment: string, bundleId: string) => Promise<{ name: string }[]>,
): Promise<RequiredFieldDescriptor> => {
  const name = field.field?.name ?? '(unnamed)'
  const c = classifyFieldType(field)
  if (c.kind !== 'bundle' || c.bundleSegment === undefined || field.bundle?.id === undefined) {
    return { name, label: name }
  }
  try {
    const allowed = (await fetchElements(c.bundleSegment, field.bundle.id)).map((e) => e.name)
    return { name, label: `${name} (one of: ${formatAllowed(allowed)})` }
  } catch {
    return { name, label: name }
  }
}

// Marks the project fields satisfied by dedicated params, resolving each to its real (possibly
// localized) field name so required-detection does not re-flag a field the caller already set.
const markDedicatedParamFields = (
  handledFields: Set<string>,
  params: CustomFieldParams,
  projectFieldsByName: ReadonlyMap<string, NamedProjectCustomField>,
): void => {
  const fields = [...projectFieldsByName.values()]
  for (const pair of collectFieldPairs(params)) {
    if (pair.source !== 'dedicated') continue
    try {
      handledFields.add(resolveDedicatedField(pair.kind, fields).field?.name ?? '')
    } catch {
      // Unresolvable dedicated param surfaces as a teaching error when payloads are built.
    }
  }
}

const dedicatedParamPresent = (params: CustomFieldParams): boolean =>
  params.status !== undefined ||
  params.priority !== undefined ||
  params.assignee !== undefined ||
  params.dueDate !== undefined

export const validateRequiredCreateFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  projectShortName: string,
  params: CustomFieldParams,
): Promise<ProjectCustomField[]> => {
  // Named generic fields and dedicated params both need the project schema to resolve. When the
  // token cannot read field-settings (admin endpoint empty), derive the schema from a sample issue
  // so fields are recognized instead of rejected as "unknown".
  const needsSchema = (params.customFields?.length ?? 0) > 0 || dedicatedParamPresent(params)
  const projectCustomFields = await fetchProjectCustomFields(config, projectId, {
    deriveFromIssueWhenEmpty: needsSchema,
    shortName: projectShortName,
  })
  const projectFieldsByName = buildProjectFieldsByName(projectCustomFields)
  const handledFields = buildHandledFieldSet(projectFieldsByName, params.customFields)
  markDedicatedParamFields(handledFields, params, projectFieldsByName)
  const requiredFields = projectCustomFields.filter(
    (field) =>
      field.canBeEmpty === false &&
      (field.defaultValues?.length ?? 0) === 0 &&
      field.field?.name !== undefined &&
      !handledFields.has(field.field.name),
  )
  if (requiredFields.length === 0) return projectCustomFields
  const fetchElements = makeBundleElementFetcher(config)
  const described = await Promise.all(requiredFields.map((field) => describeRequiredField(field, fetchElements)))
  throw new YouTrackClassifiedError(
    `Project ${projectShortName} requires these custom fields: ${described.map((d) => d.label).join('; ')}`,
    providerError.workflowValidationFailed(
      projectId,
      'The project workflow requires additional custom fields before the task can be created. Call describe_project for the full schema and valid values.',
      described.map((d) => ({ name: d.name })),
    ),
  )
}

// Shared custom-field builder for create and update: every field — dedicated (resolved by type)
// or generic (resolved by name) — flows through the field engine.
export const buildIssueCustomFields = async (
  config: Readonly<YouTrackConfig>,
  params: CustomFieldParams,
  projectCustomFields: readonly ProjectCustomField[],
  op: 'create' | 'update',
): Promise<IssueCustomFieldPayload[]> => {
  const projectFieldsByName = buildProjectFieldsByName(projectCustomFields)
  const getBundleElements = makeBundleElementFetcher(config)
  const resolved = collectFieldPairs(params).map((pair) => resolveFieldPair(pair, projectFieldsByName, op))
  const payloads = await Promise.all(
    resolved.map((r) => resolveCustomFieldValue(r.field, r.value, { getBundleElements })),
  )
  return payloads
}

export { buildYouTrackQuery } from './query-builder.js'

export const enrichTaskWithDueDate = async (config: Readonly<YouTrackConfig>, task: Readonly<Task>): Promise<Task> => {
  try {
    const customFields = await paginate(
      config,
      `/api/issues/${task.id}/customFields`,
      { fields: 'name,value' },
      DueDateCustomFieldSchema.array(),
    )
    const dueDateField = customFields.find((field) => field.name === YOUTRACK_DUE_DATE_FIELD_NAME)
    const dueDate = typeof dueDateField?.value === 'number' ? mapYouTrackDueDateValue(dueDateField.value) : undefined
    return dueDate === undefined ? { ...task, dueDate: task.dueDate ?? null } : { ...task, dueDate }
  } catch {
    return { ...task }
  }
}

export { mapYouTrackDueDateValue } from './due-date.js'
export { mapReadOnlyCustomFields } from './custom-field-values.js'
