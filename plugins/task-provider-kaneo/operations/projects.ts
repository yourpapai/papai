// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Project } from 'papai/plugin-types'

import type { KaneoConfig } from '../client.js'
import { createProject } from '../create-project.js'
import { deleteProject } from '../delete-project.js'
import { listProjects } from '../list-projects.js'
import { mapProject } from '../mappers.js'
import { updateProject } from '../update-project.js'
import { buildProjectUrl } from '../url-builder.js'

export async function kaneoListProjects(config: KaneoConfig, workspaceId: string): Promise<Project[]> {
  const results = await listProjects({ config, workspaceId })
  return results.map((p) => mapProject(p, buildProjectUrl(config.baseUrl, workspaceId, p.id)))
}

export async function kaneoCreateProject(
  config: KaneoConfig,
  workspaceId: string,
  params: { name: string; description?: string },
): Promise<Project> {
  const result = await createProject({
    config,
    workspaceId,
    name: params.name,
    description: params.description,
  })
  return mapProject(result, buildProjectUrl(config.baseUrl, workspaceId, result.id))
}

export async function kaneoUpdateProject(
  config: KaneoConfig,
  workspaceId: string,
  projectId: string,
  params: { name?: string; description?: string },
): Promise<Project> {
  const result = await updateProject({
    config,
    workspaceId,
    projectId,
    name: params.name,
    description: params.description,
  })
  return mapProject(result, buildProjectUrl(config.baseUrl, workspaceId, result.id))
}

export async function kaneoDeleteProject(config: KaneoConfig, projectId: string): Promise<{ id: string }> {
  const result = await deleteProject({ config, projectId })
  return { id: result.id }
}
