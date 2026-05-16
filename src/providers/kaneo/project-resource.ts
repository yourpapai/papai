// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { GetProjectResponseSchema } from './schemas/get-project.js'
import { ProjectSchema } from './schemas/update-project.js'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
}

// Use schemas from schema directory
const KaneoProjectSchema = ProjectSchema
const KaneoProjectFullSchema = GetProjectResponseSchema

export class ProjectResource {
  private log = logger.child({ scope: 'kaneo:project-resource' })

  constructor(private config: KaneoConfig) {}

  async create(params: {
    workspaceId: string
    name: string
    description?: string
  }): Promise<z.infer<typeof KaneoProjectSchema>> {
    this.log.debug({ workspaceId: params.workspaceId, name: params.name }, 'Creating project')

    try {
      const project = await kaneoFetch(
        this.config,
        'POST',
        '/project',
        {
          name: params.name,
          workspaceId: params.workspaceId,
          icon: '',
          slug: generateSlug(params.name),
        },
        undefined,
        KaneoProjectSchema,
      )

      if (params.description !== undefined) {
        await kaneoFetch(
          this.config,
          'PUT',
          `/project/${project.id}`,
          {
            name: project.name,
            icon: '',
            slug: project.slug,
            description: params.description,
            isPublic: false,
          },
          undefined,
          KaneoProjectSchema,
        )
      }

      this.log.info({ projectId: project.id, name: project.name }, 'Project created')
      return project
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create project')
      throw classifyKaneoError(error)
    }
  }

  async list(workspaceId: string): Promise<z.infer<typeof KaneoProjectSchema>[]> {
    this.log.debug({ workspaceId }, 'Listing projects')

    try {
      const projects = await kaneoFetch(
        this.config,
        'GET',
        '/project',
        undefined,
        { workspaceId },
        z.array(KaneoProjectSchema),
      )
      this.log.info({ count: projects.length }, 'Projects listed')
      return projects
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list projects')
      throw classifyKaneoError(error)
    }
  }

  async update(
    projectId: string,
    workspaceId: string,
    params: { name?: string; description?: string },
  ): Promise<z.infer<typeof KaneoProjectSchema>> {
    this.log.debug({ projectId, workspaceId, ...params }, 'Updating project')

    try {
      const existing = await kaneoFetch(
        this.config,
        'GET',
        `/project/${projectId}`,
        undefined,
        { workspaceId },
        KaneoProjectFullSchema,
      )
      const body = {
        name: params.name ?? existing.name,
        icon: existing.icon ?? '',
        slug: existing.slug,
        description: params.description ?? existing.description ?? '',
        isPublic: existing.isPublic ?? false,
      }
      const project = await kaneoFetch(this.config, 'PUT', `/project/${projectId}`, body, undefined, KaneoProjectSchema)
      this.log.info({ projectId, name: project.name }, 'Project updated')
      return project
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update project')
      throw classifyKaneoError(error, { projectId })
    }
  }

  async delete(projectId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ projectId }, 'Deleting project')

    try {
      await kaneoFetch(this.config, 'DELETE', `/project/${projectId}`, undefined, undefined, z.unknown())
      this.log.info({ projectId }, 'Project deleted')
      return { id: projectId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to delete project')
      throw classifyKaneoError(error, { projectId })
    }
  }
}
