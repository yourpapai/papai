// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import { modelResponseError } from './errors.js'

const FENCE_PATTERN = /```(?:json)?\s*([\S\s]*?)```/giu

const tryParse = (raw: string): unknown => {
  try {
    const value: unknown = JSON.parse(raw.trim())
    return typeof value === 'object' && value !== null ? value : null
  } catch {
    return null
  }
}

/**
 * Pulls a JSON object out of a model reply.
 *
 * Models wrap JSON in prose or fences however they like, so this tries fenced
 * blocks first, then the outermost `{…}` span. Returns `null` when nothing
 * parses — callers decide whether that is fatal.
 */
export const extractJsonObject = (text: string): unknown => {
  for (const match of text.matchAll(FENCE_PATTERN)) {
    const candidate = match[1]
    if (candidate === undefined) continue
    const parsed = tryParse(candidate)
    if (parsed !== null) return parsed
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return tryParse(text.slice(start, end + 1))
}

export type ModelJsonResult<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * Extracts and validates a structured model reply, reporting *why* it failed.
 *
 * Separate from {@link parseModelJson} so a caller can act on the reason —
 * re-asking the model with the complaint attached — instead of only turning it
 * into a failure comment. The reason alone, without the raw text, is what a
 * repair prompt wants: the model already knows what it said.
 */
export const readModelJson = <T>(text: string, schema: z.ZodType<T>): ModelJsonResult<T> => {
  const candidate = extractJsonObject(text)
  if (candidate === null) return { ok: false, reason: 'Model reply contained no JSON object' }

  const result = schema.safeParse(candidate)
  if (!result.success) return { ok: false, reason: `Model reply failed validation: ${result.error.message}` }

  return { ok: true, value: result.data }
}

/**
 * Extracts and validates a structured model reply. Throws a `PipelineError`
 * carrying the raw text, so the failure comment on the issue shows what the
 * model actually said instead of a bare schema complaint.
 */
export const parseModelJson = <T>(text: string, schema: z.ZodType<T>): T => {
  const result = readModelJson(text, schema)
  if (!result.ok) throw modelResponseError(result.reason, text)
  return result.value
}
