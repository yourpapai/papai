// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label, TaskLabel, TaskProvider } from '../providers/types.js'

export function isKaneoProvider(provider: Readonly<TaskProvider>): boolean {
  return provider.name === 'kaneo'
}

export function listWorkspaceLabels(provider: Readonly<TaskProvider>): Promise<Label[]> {
  if (provider.listLabels === undefined) return Promise.resolve([])
  return provider.listLabels()
}

export function listVisibleWorkspaceLabels(
  provider: Readonly<TaskProvider>,
  labelName: string | undefined,
): Promise<Label[]> {
  if (provider.getLabelByName !== undefined && labelName !== undefined) {
    return provider.getLabelByName(labelName)
  }
  return listWorkspaceLabels(provider)
}

export function listTaskLabels(provider: Readonly<TaskProvider>, taskId: string): Promise<TaskLabel[]> {
  if (!isKaneoProvider(provider) || provider.listTaskLabels === undefined) return Promise.resolve([])
  return provider.listTaskLabels(taskId)
}
