// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const ragSearchSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      description: 'Natural-language search query for the corporate knowledge base',
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const
