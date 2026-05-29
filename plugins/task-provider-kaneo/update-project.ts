// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { ProjectSchema } from './schemas/update-project.js'

const log = logger.child({ scope: 'kaneo:update-project' })

type UpdateProjectResponse = z.infer<typeof ProjectSchema>
type KaneoProject = UpdateProjectResponse

export async function updateProject({
  config,
  workspaceId,
  projectId,
  name,
  description,
}: {
  config: KaneoConfig
  workspaceId: string
  projectId: string
  name?: string
  description?: string
}): Promise<KaneoProject> {
  log.debug(
    {
      projectId,
      workspaceId,
      hasName: name !== undefined,
      hasDescription: description !== undefined,
    },
    'updateProject called',
  )

  if (name === undefined && description === undefined) {
    throw new KaneoClassifiedError(
      'At least one field (name or description) must be provided to update a project',
      providerError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const client = new KaneoClient(config)
    const project = await client.projects.update(projectId, workspaceId, { name, description })
    log.info({ projectId, workspaceId, name: project.name }, 'Project updated')
    return project
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId, workspaceId },
      'updateProject failed',
    )
    throw classifyKaneoError(error)
  }
}
