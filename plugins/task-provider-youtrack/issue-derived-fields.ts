// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../src/logger.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { ProjectCustomFieldSchema } from './schemas/bundle.js'

const log = logger.child({ scope: 'provider:youtrack:custom-fields' })

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

// An issue's `projectCustomField` sub-entity carries the same field settings the admin
// `/customFields` endpoint exposes (type, bundle, canBeEmpty, defaultValues), but is
// readable by any user who can view the issue. This is the schema source for tokens that
// lack project field-settings admin rights — where the admin endpoint answers 200 with [].
const ISSUE_PROJECT_FIELD_FIELDS =
  'customFields(projectCustomField(id,$type,canBeEmpty,isPublic,field(id,name,localizedName,$type,fieldType(id,presentation)),bundle(id,$type),defaultValues(name,localizedName)))'

const IssueProjectFieldsSchema = z.array(
  z.object({
    customFields: z.array(z.object({ projectCustomField: ProjectCustomFieldSchema.nullish() })).optional(),
  }),
)

const fetchProjectShortName = async (config: Readonly<YouTrackConfig>, projectId: string): Promise<string> => {
  const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, {
    query: { fields: 'shortName' },
  })
  return z.object({ shortName: z.string() }).parse(projectRaw).shortName
}

/**
 * Fallback schema source: read one issue from the project and lift each field's
 * `projectCustomField` settings into the `ProjectCustomField` shape the field engine
 * already understands. Returns an empty list when the project has no issues to sample.
 * Pass `knownShortName` (when the caller already resolved it) to skip the project lookup.
 */
export const fetchProjectCustomFieldsViaIssue = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  knownShortName?: string,
): Promise<ProjectCustomField[]> => {
  const shortName = knownShortName ?? (await fetchProjectShortName(config, projectId))
  const raw = await youtrackFetch(config, 'GET', '/api/issues', {
    query: { query: `project: {${shortName}}`, $top: '1', fields: ISSUE_PROJECT_FIELD_FIELDS },
  })
  const issues = IssueProjectFieldsSchema.parse(raw)
  const fields = (issues[0]?.customFields ?? [])
    .map((entry) => entry.projectCustomField)
    .filter((field): field is ProjectCustomField => field !== null && field !== undefined)
  log.debug(
    {
      projectId,
      shortName,
      count: fields.length,
      fieldNames: fields.map((f) => f.field?.name ?? '(unnamed)'),
    },
    'Derived project custom fields from sample issue',
  )
  return fields
}
