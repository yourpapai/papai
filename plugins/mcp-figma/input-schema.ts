// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const fileKey = { type: 'string', minLength: 1, description: 'Figma file key (from the file URL)' } as const

export const figmaGetFileSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const

export const figmaGetFileNodesSchema = {
  type: 'object',
  properties: {
    fileKey,
    ids: { type: 'string', minLength: 1, description: 'Comma/;-separated node ids, e.g. "1:2,3:4"' },
  },
  required: ['fileKey', 'ids'],
  additionalProperties: false,
} as const

export const figmaGetImagesSchema = {
  type: 'object',
  properties: {
    fileKey,
    ids: { type: 'string', minLength: 1, description: 'Comma/;-separated node ids' },
    format: { type: 'string', enum: ['png', 'svg', 'pdf'], description: 'Image format (default png)' },
    scale: { type: 'number', minimum: 0.01, maximum: 4, description: 'Scale (png only)' },
  },
  required: ['fileKey', 'ids'],
  additionalProperties: false,
} as const

export const figmaGetFileStylesSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const

export const figmaGetStyleSchema = {
  type: 'object',
  properties: {
    fileKey,
    styleKey: { type: 'string', minLength: 1, description: 'Style key, e.g. "S:abc123"' },
  },
  required: ['fileKey', 'styleKey'],
  additionalProperties: false,
} as const

export const figmaGetComponentsSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const

export const figmaGetCommentsSchema = {
  type: 'object',
  properties: { fileKey },
  required: ['fileKey'],
  additionalProperties: false,
} as const
