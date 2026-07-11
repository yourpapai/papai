// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const teamcityGetProjectsSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

export const teamcityGetProjectConfigSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', minLength: 1, description: 'TeamCity project id, e.g. "MyProject" or "_Root"' },
  },
  required: ['projectId'],
  additionalProperties: false,
} as const

export const teamcityGetProjectPipelinesSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', minLength: 1, description: 'TeamCity project id' },
  },
  required: ['projectId'],
  additionalProperties: false,
} as const

export const teamcityGetPipelineConfigSchema = {
  type: 'object',
  properties: {
    buildTypeId: { type: 'string', minLength: 1, description: 'TeamCity build configuration (pipeline) id' },
  },
  required: ['buildTypeId'],
  additionalProperties: false,
} as const
