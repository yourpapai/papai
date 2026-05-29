// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
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

function isZodObject(schema: unknown): schema is z.ZodObject<z.ZodRawShape> {
  return schema instanceof z.ZodObject
}

export function extendSchemaForAsk(schema: unknown): z.ZodObject<z.ZodRawShape> {
  if (!isZodObject(schema)) {
    return z.object({ _permission_reason: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION) })
  }
  return schema.extend({
    _permission_reason: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION),
  })
}

export type AskPermissionFn = (req: { toolName: string; reason: string }) => Promise<'allow' | 'deny'>

export type ExecuteFn<O> = (input: unknown, options: ToolExecutionOptions) => Promise<O>

function extractReason(input: Record<string, unknown>): string {
  const raw = input[PERMISSION_REASON_FIELD]
  return typeof raw === 'string' ? raw : ''
}

function omitReasonField(input: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(input).filter(([k]) => k !== PERMISSION_REASON_FIELD)
  return Object.fromEntries(entries)
}

export function gatedExecute<O>(
  execute: ExecuteFn<O>,
  toolName: string,
  askPermission: AskPermissionFn | undefined,
): ExecuteFn<O | PermissionDeniedResult> {
  return async (input: unknown, options: ToolExecutionOptions): Promise<O | PermissionDeniedResult> => {
    if (askPermission === undefined) {
      return buildPermissionDenied(`Tool '${toolName}' requires user permission, but no chat surface is available.`)
    }
    const inputRecord: Record<string, unknown> = {}
    if (typeof input === 'object' && input !== null) {
      for (const [k, v] of Object.entries(input)) {
        inputRecord[k] = v
      }
    }
    const reason = extractReason(inputRecord)
    const cleaned = omitReasonField(inputRecord)
    const decision = await askPermission({ toolName, reason })
    if (decision === 'deny') {
      return buildPermissionDenied(`User denied execution of '${toolName}'.`)
    }
    return execute(cleaned, options)
  }
}
