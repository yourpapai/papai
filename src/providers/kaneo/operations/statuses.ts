// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Column } from '../../types.js'
import type { KaneoConfig } from '../client.js'
import { createColumn } from '../create-column.js'
import { deleteColumn } from '../delete-column.js'
import { listColumns } from '../list-columns.js'
import { mapColumn } from '../mappers.js'
import { reorderColumns } from '../reorder-columns.js'
import { updateColumn } from '../update-column.js'

export async function kaneoListStatuses(config: KaneoConfig, projectId: string): Promise<Column[]> {
  const results = await listColumns({ config, projectId })
  return results.map(mapColumn)
}

export async function kaneoCreateStatus(
  config: KaneoConfig,
  projectId: string,
  params: { name: string; icon?: string; color?: string; isFinal?: boolean },
): Promise<Column> {
  const result = await createColumn({ config, projectId, ...params })
  return mapColumn(result)
}

export async function kaneoUpdateStatus(
  config: KaneoConfig,
  statusId: string,
  params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
): Promise<Column> {
  const result = await updateColumn({ config, columnId: statusId, ...params })
  return mapColumn(result)
}

export async function kaneoDeleteStatus(config: KaneoConfig, statusId: string): Promise<{ id: string }> {
  const result = await deleteColumn({ config, columnId: statusId })
  return { id: result.id }
}

export async function kaneoReorderStatuses(
  config: KaneoConfig,
  projectId: string,
  statuses: { id: string; position: number }[],
): Promise<undefined> {
  await reorderColumns({ config, projectId, columns: statuses })
  return undefined
}
