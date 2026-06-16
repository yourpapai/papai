// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProjectFieldDescriptor } from 'papai/plugin-types'
import type { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { makeBundleElementFetcher } from '../bundle-values.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { capAllowedValues, classifyFieldType } from '../field-engine.js'
import type { ProjectCustomFieldSchema } from '../schemas/bundle.js'
import { fetchProjectCustomFields } from '../task-helpers.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

const log = logger.child({ scope: 'provider:youtrack:project-fields' })

const describeField = async (
  field: Readonly<ProjectCustomField>,
  getBundleElements: (segment: string, bundleId: string) => Promise<{ name: string }[]>,
): Promise<ProjectFieldDescriptor> => {
  const name = field.field?.name ?? '(unnamed)'
  const c = classifyFieldType(field)
  const required = field.canBeEmpty === false && (field.defaultValues?.length ?? 0) === 0
  const defaultValue = field.defaultValues?.[0]?.name
  let allowedValues: string[] | undefined
  if (c.kind === 'bundle' && c.bundleSegment !== undefined && field.bundle?.id !== undefined) {
    try {
      allowedValues = capAllowedValues((await getBundleElements(c.bundleSegment, field.bundle.id)).map((e) => e.name))
    } catch {
      allowedValues = undefined
    }
  }
  return { name, type: c.label, multi: c.multi, required, defaultValue, allowedValues }
}

export const describeYouTrackProjectFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
): Promise<ProjectFieldDescriptor[]> => {
  log.debug({ projectId }, 'describeProjectFields')
  try {
    const fields = await fetchProjectCustomFields(config, projectId, { deriveFromIssueWhenEmpty: true })
    const getBundleElements = makeBundleElementFetcher(config)
    const descriptors = await Promise.all(fields.map((field) => describeField(field, getBundleElements)))
    log.info({ projectId, count: descriptors.length }, 'Project fields described')
    return descriptors
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to describe project fields',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}
