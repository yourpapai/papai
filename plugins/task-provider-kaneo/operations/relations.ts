// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RelationType } from 'papai/plugin-types'

import { addTaskRelation } from '../add-task-relation.js'
import type { KaneoConfig } from '../client.js'
import { removeTaskRelation } from '../remove-task-relation.js'
import { updateTaskRelation } from '../update-task-relation.js'

export function kaneoAddRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  return addTaskRelation({ config, taskId, relatedTaskId, type })
}

export function kaneoUpdateRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  return updateTaskRelation({ config, taskId, relatedTaskId, type })
}

export async function kaneoRemoveRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string }> {
  const result = await removeTaskRelation({ config, taskId, relatedTaskId })
  return { taskId: result.taskId, relatedTaskId: result.relatedTaskId }
}
