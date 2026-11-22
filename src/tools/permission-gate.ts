// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FlexibleSchema, ToolApprovalStatus, ToolExecutionOptions } from 'ai'
import { jsonSchema } from 'ai'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { getToolPrefs, resolveToolPermission } from './tool-preferences.js'

const log = logger.child({ scope: 'tools:permission-gate' })

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
    // Best-effort: return the reason-only schema so the approval resolver still receives a reason.
    return z.object({ [PERMISSION_REASON_FIELD]: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION) })
  }
  const merged = mergeJsonSchemaWithPermissionReason(wrappedJson)
  return jsonSchema(merged)
}

export type AskPermissionDecision = 'allow' | 'deny' | 'ignored'

export type AskPermissionFn = (req: {
  toolName: string
  reason: string
  args: Record<string, unknown>
}) => Promise<AskPermissionDecision>

export type ExecuteFn<O> = (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<O>

function extractReason(input: Record<string, unknown>): string {
  const raw = input[PERMISSION_REASON_FIELD]
  return typeof raw === 'string' ? raw : ''
}

function omitReasonField(input: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(input).filter(([k]) => k !== PERMISSION_REASON_FIELD)
  return Object.fromEntries(entries)
}

function toRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  const record: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) record[key] = value
  return record
}

/**
 * Assembly-side wrapper for an `ask` tool. Approval now runs before execution via
 * the SDK's `toolApproval` hook, so execution only strips the model-authored reason.
 */
export function stripPermissionReason<O>(execute: ExecuteFn<O>): ExecuteFn<O> {
  return (input, options): Promise<O> => execute(isRecord(input) ? omitReasonField(input) : input, options)
}

/** The runtime fields the approval resolver needs to attribute a denied call. */
export type ToolApprovalRuntime = Readonly<{
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  model: string
  modelRole: 'main' | 'small'
  turnId: string
}>

/** A denied approval, reported for analytics parity with an executed tool call. */
export type ToolDenial = Readonly<{
  toolName: string
  toolCallId: string
  input: unknown
  durationMs: number
  runtime: ToolApprovalRuntime | null
}>

/**
 * The generic AI SDK `toolApproval` hook. Every exposed tool goes through it; it
 * answers `not-applicable` unless the resolved `tool_prefs` permission is `ask`.
 */
export type ToolApprovalFn = (options: {
  readonly toolCall: { readonly toolName: string; readonly toolCallId: string; readonly input: unknown }
  readonly runtimeContext?: unknown
}) => Promise<ToolApprovalStatus>

export type BuildToolApprovalOptions = Readonly<{
  /** The turn's storage context id; permission resolution re-derives the config context. */
  contextId: string
  /** The chat-bound prompt; absent on surfaces that cannot ask (proactive turns). */
  askPermission: AskPermissionFn | undefined
  /** Called once for every denied call, before the SDK emits the denied tool result. */
  onDenied?: (denial: ToolDenial) => void
  /** Injectable clock for approval-latency measurement (tests only). */
  now?: () => number
}>

const runtimeOf = (value: unknown): ToolApprovalRuntime | null => {
  if (!isRecord(value)) return null
  const { contextId, chatUserId, contextType, model, modelRole, turnId } = value
  if (
    typeof contextId !== 'string' ||
    typeof chatUserId !== 'string' ||
    typeof model !== 'string' ||
    typeof turnId !== 'string' ||
    (contextType !== 'dm' && contextType !== 'group') ||
    (modelRole !== 'main' && modelRole !== 'small')
  ) {
    return null
  }
  return { contextId, chatUserId, contextType, model, modelRole, turnId }
}

const userDeniedReason = (toolName: string): string => `User denied execution of '${toolName}'.`

const timeoutReason = (toolName: string): string =>
  `Permission prompt for '${toolName}' timed out after five minutes; the call was denied.`

const noSurfaceReason = (toolName: string): string =>
  `Tool '${toolName}' requires user permission, but no chat surface is available.`

export function buildToolApproval(options: BuildToolApprovalOptions): ToolApprovalFn {
  const { contextId, askPermission, onDenied, now = Date.now } = options
  return async ({ toolCall, runtimeContext }): Promise<ToolApprovalStatus> => {
    const { toolName, toolCallId, input } = toolCall
    // Re-resolve at call time: a preference tightened mid-turn must still prompt.
    const prefsContextId = getConfigContextIdFromStorageContextId(contextId)
    const permission = resolveToolPermission(getToolPrefs(prefsContextId), toolName)
    if (permission !== 'ask') return 'not-applicable'

    const runtime = runtimeOf(runtimeContext)
    const deny = (reason: string, durationMs: number): ToolApprovalStatus => {
      onDenied?.({ toolName, toolCallId, input, durationMs, runtime })
      return { type: 'denied', reason }
    }

    if (askPermission === undefined) return deny(noSurfaceReason(toolName), 0)

    const startedAt = now()
    const inputRecord = toRecord(input)
    const decision = await askPermission({
      toolName,
      reason: extractReason(inputRecord),
      args: omitReasonField(inputRecord),
    })
    const durationMs = Math.max(0, now() - startedAt)

    if (decision === 'allow') return 'approved'
    return deny(decision === 'ignored' ? timeoutReason(toolName) : userDeniedReason(toolName), durationMs)
  }
}
