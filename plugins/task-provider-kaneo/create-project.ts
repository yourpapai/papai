// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import type { Project } from './schemas/update-project.js'

const log = logger.child({ scope: 'kaneo:create-project' })

type KaneoProject = Project

export async function createProject({
  config,
  workspaceId,
  name,
  description,
}: {
  config: KaneoConfig
  workspaceId: string
  name: string
  description?: string
}): Promise<KaneoProject> {
  log.debug({ workspaceId, name, hasDescription: description !== undefined }, 'createProject called')

  try {
    const client = new KaneoClient(config)
    const project = await client.projects.create({ workspaceId, name, description })
    log.info({ workspaceId, projectId: project.id, name }, 'Project created')
    return project
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, name },
      'createProject failed',
    )
    throw classifyKaneoError(error)
  }
}
