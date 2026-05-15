// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { providerError } from '../../providers/errors.js'
import { KaneoClassifiedError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { listColumns as defaultListColumns } from './list-columns.js'

const log = logger.child({ scope: 'kaneo:task-status' })

export interface TaskStatusDeps {
  listColumns: (opts: { config: KaneoConfig; projectId: string }) => Promise<Array<{ id: string; name: string }>>
}

const defaultTaskStatusDeps: TaskStatusDeps = {
  listColumns: (...args) => defaultListColumns(...args),
}

/**
 * Validate and normalize a status string against project columns.
 * Returns the slugified status that matches a column.
 */
export async function validateStatus(
  config: KaneoConfig,
  projectId: string,
  status: string,
  deps: TaskStatusDeps = defaultTaskStatusDeps,
): Promise<string> {
  log.debug({ projectId, status }, 'Validating status')
  const columns = await deps.listColumns({ config, projectId })

  // Normalize the input status
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, '-')

  // Check if it matches any column name (slugified)
  for (const column of columns) {
    const columnSlug = column.name.toLowerCase().replace(/\s+/g, '-')
    if (columnSlug === normalizedStatus) {
      // Return the slug, not the column ID
      // The Kaneo task API expects slugs, not the random IDs from listColumns
      return normalizedStatus
    }
  }

  // Also check if it's already a valid slug (matches pattern like "to-do" or "to-do-123")
  const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/
  if (slugPattern.test(normalizedStatus)) {
    // Check if any column's slug starts with this (for partial matches like "to-do")
    for (const column of columns) {
      const columnSlug = column.name.toLowerCase().replace(/\s+/g, '-')
      if (columnSlug === normalizedStatus || columnSlug.startsWith(normalizedStatus + '-')) {
        return normalizedStatus
      }
    }
  }

  // No match found - throw classified error with helpful message
  const available = columns.map((c) => c.name)
  throw new KaneoClassifiedError(
    `Invalid status "${status}". Must match one of: ${available.join(', ')}`,
    providerError.statusNotFound(status, available),
  )
}

/**
 * Denormalize a status slug back to the canonical column slug.
 * This handles cases where the stored status might be a column ID.
 */
export async function denormalizeStatus(
  config: KaneoConfig,
  projectId: string,
  statusSlug: string,
  deps: TaskStatusDeps = defaultTaskStatusDeps,
): Promise<string> {
  log.debug({ projectId, statusSlug }, 'Denormalizing status')
  const columns = await deps.listColumns({ config, projectId })
  // Try to find a column whose name slug matches the status
  for (const column of columns) {
    const columnSlug = column.name.toLowerCase().replace(/\s+/g, '-')
    if (columnSlug === statusSlug || statusSlug.startsWith(columnSlug + '-')) {
      return columnSlug
    }
  }
  return statusSlug
}
