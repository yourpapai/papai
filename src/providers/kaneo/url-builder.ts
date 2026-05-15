// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function buildTaskUrl(baseUrl: string, workspaceId: string, projectId: string, taskId: string): string {
  return `${baseUrl}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`
}

export function buildProjectUrl(baseUrl: string, workspaceId: string, projectId: string): string {
  return `${baseUrl}/dashboard/workspace/${workspaceId}/project/${projectId}`
}
