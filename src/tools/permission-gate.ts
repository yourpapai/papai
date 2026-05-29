// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export interface PermissionDeniedResult {
  readonly status: 'permission_denied'
  readonly message: string
}

export function buildPermissionDenied(message: string): PermissionDeniedResult {
  return { status: 'permission_denied', message }
}

const PERMISSION_REASON_DESCRIPTION =
  'Brief, user-facing reason this tool call is needed. ' +
  'Shown verbatim in the permission prompt. ' +
  'One sentence, present tense, no markdown.'

export const PERMISSION_REASON_FIELD = '_permission_reason'

export function extendSchemaForAsk(schema: z.ZodObject<z.ZodRawShape>): z.ZodObject<z.ZodRawShape> {
  return schema.extend({
    _permission_reason: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION),
  })
}
