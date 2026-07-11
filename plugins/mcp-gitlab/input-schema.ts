// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const projectPath = { type: 'string', minLength: 1, description: 'Project path, e.g. "group/project"' } as const

export const gitlabGetRepositoryTreeSchema = {
  type: 'object',
  properties: {
    projectPath,
    path: { type: 'string', description: 'Subdirectory path (default root)' },
    ref: { type: 'string', description: 'Branch/tag/commit (default HEAD)' },
    recursive: { type: 'boolean', description: 'Recurse into subdirectories' },
  },
  required: ['projectPath'],
  additionalProperties: false,
} as const

export const gitlabGetFileContentSchema = {
  type: 'object',
  properties: {
    projectPath,
    filePath: { type: 'string', minLength: 1, description: 'File path relative to repo root' },
    ref: { type: 'string', description: 'Branch/tag/commit (default HEAD)' },
  },
  required: ['projectPath', 'filePath'],
  additionalProperties: false,
} as const

export const gitlabGetMrInfoSchema = {
  type: 'object',
  properties: {
    projectPath,
    mrIid: { type: 'string', minLength: 1, description: 'MR iid, e.g. "42"' },
  },
  required: ['projectPath', 'mrIid'],
  additionalProperties: false,
} as const

export const gitlabGetMrsSchema = {
  type: 'object',
  properties: {
    projectPath,
    state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'] },
    search: { type: 'string' },
    labels: { type: 'string', description: 'Comma-separated labels' },
    sourceBranch: { type: 'string' },
    targetBranch: { type: 'string' },
    orderBy: { type: 'string', enum: ['created_at', 'updated_at'] },
    sort: { type: 'string', enum: ['asc', 'desc'] },
    perPage: { type: 'integer', minimum: 1, maximum: 100 },
    page: { type: 'integer', minimum: 1 },
  },
  required: ['projectPath'],
  additionalProperties: false,
} as const

export const gitlabGetJobSchema = {
  type: 'object',
  properties: {
    projectPath,
    jobId: { type: 'string', minLength: 1, description: 'Numeric job id' },
  },
  required: ['projectPath', 'jobId'],
  additionalProperties: false,
} as const
