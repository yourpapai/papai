// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const REPO_PRESETS = ['autonomous', 'cautious', 'readonly'] as const
export type RepoPreset = (typeof REPO_PRESETS)[number]

export interface RepoInput {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: RepoPreset
}

export interface RepoRecord extends RepoInput {
  repoId: string
}
