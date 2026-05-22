// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label, TaskLabel, TaskProvider } from '../providers/types.js'

export function isKaneoProvider(provider: Readonly<TaskProvider>): boolean {
  return provider.name === 'kaneo'
}

export async function listVisibleWorkspaceLabels(
  provider: Readonly<TaskProvider>,
  labelName?: string,
): Promise<Label[]> {
  if (provider.getLabelByName !== undefined && labelName !== undefined) {
    return await provider.getLabelByName(labelName)
  }
  return (await provider.listLabels?.()) ?? []
}

export async function listTaskLabels(provider: Readonly<TaskProvider>, taskId: string): Promise<TaskLabel[]> {
  if (!isKaneoProvider(provider) || provider.listTaskLabels === undefined) return []
  return await provider.listTaskLabels(taskId)
}
