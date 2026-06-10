// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FlexibleSchema, ToolExecutionOptions } from 'ai'
import { jsonSchema } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'tools:permission-gate' })

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

const PERMISSION_REASON_JSON_PROPERTY = {
  type: 'string',
  minLength: 1,
  maxLength: 280,
  description: PERMISSION_REASON_DESCRIPTION,
} as const

function isZodObject(schema: unknown): schema is z.ZodObject<z.ZodRawShape> {
  return schema instanceof z.ZodObject
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getJsonFromSchema(schema: unknown): Record<string, unknown> | null {
  if (!isRecord(schema)) return null
  // The AI SDK Schema type exposes the underlying JSON schema via .jsonSchema
  const raw = schema['jsonSchema']
  if (isRecord(raw)) return raw
  return null
}

function extractProperties(original: Record<string, unknown>): Record<string, unknown> {
  const props = original['properties']
  return isRecord(props) ? props : {}
}

function extractRequired(original: Record<string, unknown>): string[] {
  if (!Array.isArray(original['required'])) return []
  return original['required'].filter((item): item is string => typeof item === 'string')
}

function mergeJsonSchemaWithPermissionReason(original: Record<string, unknown>): Record<string, unknown> {
  const properties = extractProperties(original)
  const required = extractRequired(original)
  return {
    ...original,
    type: 'object',
    properties: { ...properties, [PERMISSION_REASON_FIELD]: PERMISSION_REASON_JSON_PROPERTY },
    required: required.includes(PERMISSION_REASON_FIELD) ? required : [...required, PERMISSION_REASON_FIELD],
  }
}

export function extendSchemaForAsk(schema: z.ZodObject<z.ZodRawShape>): z.ZodObject<z.ZodRawShape>
export function extendSchemaForAsk(schema: unknown): FlexibleSchema
export function extendSchemaForAsk(schema: unknown): FlexibleSchema {
  if (isZodObject(schema)) {
    return schema.extend({
      [PERMISSION_REASON_FIELD]: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION),
    })
  }
  const wrappedJson = getJsonFromSchema(schema)
  if (wrappedJson === null) {
    log.warn({ schemaType: typeof schema }, 'Cannot extend schema for ask; missing JSON shape')
    // Best-effort: return original schema untouched. Gate will deny without _permission_reason.
    return z.object({ [PERMISSION_REASON_FIELD]: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION) })
  }
  const merged = mergeJsonSchemaWithPermissionReason(wrappedJson)
  return jsonSchema(merged)
}

export type AskPermissionFn = (req: {
  toolName: string
  reason: string
  args: Record<string, unknown>
}) => Promise<'allow' | 'deny'>

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
    const decision = await askPermission({ toolName, reason, args: cleaned })
    if (decision === 'deny') {
      return buildPermissionDenied(`User denied execution of '${toolName}'.`)
    }
    return execute(cleaned, options)
  }
}
