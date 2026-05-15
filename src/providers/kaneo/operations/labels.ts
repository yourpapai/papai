// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label } from '../../types.js'
import { addTaskLabel } from '../add-task-label.js'
import type { KaneoConfig } from '../client.js'
import { createLabel } from '../create-label.js'
import { listLabels } from '../list-labels.js'
import { mapLabel } from '../mappers.js'
import { removeLabel } from '../remove-label.js'
import { removeTaskLabel } from '../remove-task-label.js'
import { updateLabel } from '../update-label.js'

export async function kaneoListLabels(config: KaneoConfig, workspaceId: string): Promise<Label[]> {
  const results = await listLabels({ config, workspaceId })
  return results.map(mapLabel)
}

export async function kaneoCreateLabel(
  config: KaneoConfig,
  workspaceId: string,
  params: { name: string; color?: string },
): Promise<Label> {
  const result = await createLabel({ config, workspaceId, name: params.name, color: params.color })
  return mapLabel(result)
}

export async function kaneoUpdateLabel(
  config: KaneoConfig,
  labelId: string,
  params: { name?: string; color?: string },
): Promise<Label> {
  const result = await updateLabel({ config, labelId, name: params.name, color: params.color })
  return mapLabel(result)
}

export async function kaneoRemoveLabel(config: KaneoConfig, labelId: string): Promise<{ id: string }> {
  const result = await removeLabel({ config, labelId })
  return { id: result.id }
}

export function kaneoAddTaskLabel(
  config: KaneoConfig,
  workspaceId: string,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  return addTaskLabel({ config, taskId, labelId, workspaceId })
}

export async function kaneoRemoveTaskLabel(
  config: KaneoConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  const result = await removeTaskLabel({ config, taskId, labelId })
  return { taskId: result.taskId, labelId: result.labelId }
}
