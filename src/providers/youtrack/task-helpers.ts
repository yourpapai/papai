// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import { providerError } from '../../errors.js'
import type { ListTasksParams, Task } from '../types.js'
import { YouTrackClassifiedError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { PROJECT_CUSTOM_FIELD_FIELDS, YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import { DueDateCustomFieldSchema, mapYouTrackDueDateValue, parseDueDateValue } from './due-date.js'
import { paginate } from './helpers.js'
import { ProjectCustomFieldListSchema, ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

type CreateIssueCustomFieldPayload = {
  name: string
  $type: 'SimpleIssueCustomField' | 'TextIssueCustomField'
  value: string | { text: string }
}

type StandardCustomFieldPayload = {
  name: string
  $type: string
  value: Record<string, string> | number
}
const NON_GENERIC_FIELD_NAMES = new Set(['State', 'Priority', 'Assignee', YOUTRACK_DUE_DATE_FIELD_NAME])
const normalizeCustomFieldType = (value: string | undefined): string | undefined => value?.trim().toLowerCase()

const isStringSimpleProjectField = (field: ProjectCustomField): boolean => {
  if (field.$type !== 'SimpleProjectCustomField') return false
  const fieldTypeId = normalizeCustomFieldType(field.field?.fieldType?.id)
  const presentation = normalizeCustomFieldType(field.field?.fieldType?.presentation)
  return fieldTypeId === 'string' || presentation === 'string'
}
const isTextProjectField = (field: ProjectCustomField): boolean => field.$type === 'TextProjectCustomField'
const fetchProjectCustomFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
): Promise<ProjectCustomField[]> => {
  const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`, {
    query: { fields: PROJECT_CUSTOM_FIELD_FIELDS },
  })
  return ProjectCustomFieldListSchema.parse(raw)
}
const buildProjectFieldsByName = (
  projectCustomFields: readonly ProjectCustomField[],
): Map<string, ProjectCustomField & { readonly field: { readonly name: string } }> =>
  new Map(
    projectCustomFields
      .filter(
        (field): field is ProjectCustomField & { readonly field: { readonly name: string } } =>
          field.field?.name !== undefined,
      )
      .map((field) => [field.field.name, field] as const),
  )
const buildHandledFieldSet = (
  projectFieldsByName: ReadonlyMap<string, ProjectCustomField & { readonly field: { readonly name: string } }>,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Set<string> => {
  const handledFields = new Set<string>()
  for (const fieldName of new Set((customFields ?? []).map((field) => field.name))) {
    const projectField = projectFieldsByName.get(fieldName)
    if (projectField === undefined) {
      throw new YouTrackClassifiedError(
        `Unknown custom field for create: ${fieldName}`,
        providerError.validationFailed(
          'customFields',
          `${fieldName} is not a known project field for this YouTrack project`,
        ),
      )
    }
    if (buildCreateIssueCustomField(projectField, '') === undefined) {
      throw new YouTrackClassifiedError(
        `Unsupported custom field for create: ${fieldName}`,
        providerError.validationFailed(
          'customFields',
          `${fieldName} is not a supported YouTrack string/text project field for create_task`,
        ),
      )
    }
    handledFields.add(fieldName)
  }
  return handledFields
}
export const buildCustomFields = (
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
): StandardCustomFieldPayload[] => {
  const fields: StandardCustomFieldPayload[] = []
  if (params.priority !== undefined) {
    fields.push({
      name: 'Priority',
      $type: 'SingleEnumIssueCustomField',
      value: { name: params.priority },
    })
  }
  if (params.status !== undefined) {
    fields.push({ name: 'State', $type: 'StateIssueCustomField', value: { name: params.status } })
  }
  if (params.dueDate !== undefined) {
    fields.push({
      name: YOUTRACK_DUE_DATE_FIELD_NAME,
      $type: 'DateIssueCustomField',
      value: parseDueDateValue(params.dueDate),
    })
  }
  if (params.assignee !== undefined) {
    fields.push({
      name: 'Assignee',
      $type: 'SingleUserIssueCustomField',
      value: { login: params.assignee },
    })
  }
  return fields
}
export const buildCreateIssueCustomField = (
  field: ProjectCustomField,
  value: string,
): CreateIssueCustomFieldPayload | undefined => {
  const name = field.field?.name
  if (name === undefined) return undefined
  if (isTextProjectField(field)) {
    return { name, $type: 'TextIssueCustomField', value: { text: value } }
  }
  if (isStringSimpleProjectField(field)) {
    return { name, $type: 'SimpleIssueCustomField', value }
  }
  return undefined
}
export const validateRequiredCreateFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  projectShortName: string,
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
): Promise<ProjectCustomField[]> => {
  const projectCustomFields = await fetchProjectCustomFields(config, projectId)
  const handledFields = buildHandledFieldSet(buildProjectFieldsByName(projectCustomFields), params.customFields)
  if (params.status !== undefined) {
    handledFields.add('State')
  }
  if (params.priority !== undefined) {
    handledFields.add('Priority')
  }
  if (params.assignee !== undefined) {
    handledFields.add('Assignee')
  }
  if (params.dueDate !== undefined) {
    handledFields.add(YOUTRACK_DUE_DATE_FIELD_NAME)
  }
  const requiredFields = projectCustomFields
    .filter((field) => field.canBeEmpty === false)
    .map((field) => field.field?.name)
    .filter((fieldName): fieldName is string => fieldName !== undefined && !handledFields.has(fieldName))
  if (requiredFields.length === 0) return projectCustomFields
  throw new YouTrackClassifiedError(
    `Project ${projectShortName} requires these custom fields: ${requiredFields.join(', ')}`,
    providerError.workflowValidationFailed(
      projectId,
      'The project workflow requires additional custom fields before the task can be created.',
      requiredFields.map((name) => ({ name })),
    ),
  )
}
export const buildCreateCustomFields = (
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
  projectCustomFields: readonly ProjectCustomField[],
): Array<StandardCustomFieldPayload | CreateIssueCustomFieldPayload> => {
  const projectFieldsByName = buildProjectFieldsByName(projectCustomFields)
  return [
    ...buildCustomFields(params),
    ...(params.customFields ?? []).map((input) => buildWriteSafeCustomFieldPayload(projectFieldsByName, input)),
  ]
}
const buildWriteSafeCustomFieldPayload = (
  projectFieldsByName: ReadonlyMap<string, ProjectCustomField & { readonly field: { readonly name: string } }>,
  input: Readonly<{ name: string; value: string }>,
): CreateIssueCustomFieldPayload => {
  const projectField = projectFieldsByName.get(input.name)
  if (projectField === undefined) {
    throw customFieldValidationError(
      `Unknown custom field for update: ${input.name}`,
      `${input.name} is not a known project field for this YouTrack project`,
    )
  }
  if (NON_GENERIC_FIELD_NAMES.has(input.name)) {
    throw customFieldValidationError(
      `Use the dedicated field for ${input.name}`,
      `Use the dedicated tool field for ${input.name}`,
    )
  }
  const payload = buildCreateIssueCustomField(projectField, input.value)
  if (payload === undefined) {
    throw customFieldValidationError(
      `Unsupported custom field for update: ${input.name}`,
      `${input.name} only supports simple string/text writes in update_task`,
    )
  }
  return payload
}
const customFieldValidationError = (reason: string, message: string): YouTrackClassifiedError =>
  new YouTrackClassifiedError(reason, providerError.validationFailed('customFields', message))
export const buildWriteSafeCustomFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Promise<CreateIssueCustomFieldPayload[]> => {
  if (customFields === undefined || customFields.length === 0) return []
  const projectFieldsByName = buildProjectFieldsByName(await fetchProjectCustomFields(config, projectId))
  return customFields.map((input) => buildWriteSafeCustomFieldPayload(projectFieldsByName, input))
}
export const buildYouTrackQuery = (params: Readonly<ListTasksParams> | undefined, projectShortName: string): string => {
  const queryParts: string[] = [`project: {${projectShortName}}`]
  if (params?.status !== undefined) queryParts.push(`State: {${params.status}}`)
  if (params?.priority !== undefined) queryParts.push(`Priority: {${params.priority}}`)
  if (params?.assigneeId !== undefined) queryParts.push(`Assignee: {${params.assigneeId}}`)
  if (params?.dueAfter !== undefined && params.dueBefore !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
    queryParts.push(`Due date: <${params.dueBefore}`)
  } else if (params?.dueAfter !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
  } else if (params?.dueBefore !== undefined) {
    queryParts.push(`Due date: <${params.dueBefore}`)
  }
  if (params?.sortBy !== undefined) {
    const sortField = params.sortBy === 'createdAt' ? 'created' : params.sortBy
    queryParts.push(`sort by: ${sortField} ${params.sortOrder ?? 'asc'}`)
  }
  return queryParts.join(' ')
}
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
