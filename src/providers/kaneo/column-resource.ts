// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
// ColumnCompatSchema accepts undefined icon/color — see src/kaneo/schemas/api-compat.ts for upstream bug reference.
import { ColumnCompatSchema } from './schemas/api-compat.js'

export class ColumnResource {
  private log = logger.child({ scope: 'kaneo:column-resource' })

  constructor(private config: KaneoConfig) {}

  async list(projectId: string): Promise<z.infer<typeof ColumnCompatSchema>[]> {
    this.log.debug({ projectId }, 'Listing columns')

    try {
      const columns = await kaneoFetch(
        this.config,
        'GET',
        `/column/${projectId}`,
        undefined,
        undefined,
        z.array(ColumnCompatSchema),
      )
      this.log.info({ projectId, count: columns.length }, 'Columns listed')
      return columns
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list columns')
      throw classifyKaneoError(error)
    }
  }

  async create(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<z.infer<typeof ColumnCompatSchema>> {
    this.log.debug({ projectId, name: params.name }, 'Creating column')

    try {
      const column = await kaneoFetch(
        this.config,
        'POST',
        `/column/${projectId}`,
        {
          name: params.name,
          icon: params.icon ?? '',
          color: params.color ?? '',
          isFinal: params.isFinal ?? false,
        },
        undefined,
        ColumnCompatSchema,
      )
      this.log.info({ columnId: column.id, name: column.name, projectId }, 'Column created')
      return column
    } catch (error) {
      this.log.error(
        { error: error instanceof Error ? error.message : String(error), projectId },
        'Failed to create column',
      )
      throw classifyKaneoError(error)
    }
  }

  async update(
    columnId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<z.infer<typeof ColumnCompatSchema>> {
    this.log.debug({ columnId, ...params }, 'Updating column')

    try {
      const body: Record<string, unknown> = {}
      if (params.name !== undefined) body['name'] = params.name
      if (params.icon !== undefined) body['icon'] = params.icon
      if (params.color !== undefined) body['color'] = params.color
      if (params.isFinal !== undefined) body['isFinal'] = params.isFinal

      const column = await kaneoFetch(this.config, 'PUT', `/column/${columnId}`, body, undefined, ColumnCompatSchema)
      this.log.info({ columnId, name: column.name }, 'Column updated')
      return column
    } catch (error) {
      this.log.error(
        { error: error instanceof Error ? error.message : String(error), columnId },
        'Failed to update column',
      )
      throw classifyKaneoError(error)
    }
  }

  async remove(columnId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ columnId }, 'Removing column')

    try {
      await kaneoFetch(this.config, 'DELETE', `/column/${columnId}`, undefined, undefined, z.unknown())
      this.log.info({ columnId }, 'Column removed')
      return { id: columnId, success: true }
    } catch (error) {
      this.log.error(
        { error: error instanceof Error ? error.message : String(error), columnId },
        'Failed to remove column',
      )
      throw classifyKaneoError(error)
    }
  }

  async reorder(projectId: string, columns: { id: string; position: number }[]): Promise<{ success: true }> {
    this.log.debug({ projectId, columnCount: columns.length }, 'Reordering columns')

    try {
      await kaneoFetch(this.config, 'PUT', `/column/reorder/${projectId}`, { columns }, undefined, z.unknown())
      this.log.info({ projectId, columnCount: columns.length }, 'Columns reordered')
      return { success: true }
    } catch (error) {
      this.log.error(
        { error: error instanceof Error ? error.message : String(error), projectId },
        'Failed to reorder columns',
      )
      throw classifyKaneoError(error)
    }
  }
}
