// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const searchInputSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      maxLength: 400,
      description: 'Search query',
    },
    max_length: {
      type: 'integer',
      minimum: 0,
      maximum: 10000,
      description: 'Maximum total characters across all results (0 = no limit)',
    },
    index: {
      type: 'integer',
      minimum: 0,
      description: 'Return only the result at this index (0-based)',
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const
