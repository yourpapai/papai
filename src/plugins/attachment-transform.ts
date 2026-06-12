// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderAttachedLine, sanitizeForBracket } from '../attachments/resolver.js'
import type { StoredAttachment } from '../attachments/types.js'
import { logger } from '../logger.js'
import type { PluginAttachmentRecord } from './attachment-types.js'
import { contributionRegistry } from './contributions.js'
import { getPluginsForContext } from './registry.js'
import type {
  AttachmentTransformResult,
  PluginAttachmentTransformer,
  PluginToolRuntimeContext,
} from './runtime-types.js'
import { buildPluginToolRuntimeContext } from './tool-runtime.js'
import type { PluginManifest } from './types.js'

const log = logger.child({ scope: 'plugins:attachment-transform' })

const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000
const DEFAULT_TIMEOUT_MS = 30_000
const HISTORY_TRANSCRIPT_MAX = 120

export type TransformLine = { line: string; historyLine: string }

type MatchableRecord = Pick<PluginAttachmentRecord, 'mimeType' | 'filename' | 'origin'>

export function matchesTransformer(
  transformer: Pick<PluginAttachmentTransformer, 'mimePrefixes' | 'filenameExtensions' | 'origins'>,
  record: MatchableRecord,
): boolean {
  const origin = record.origin ?? 'file'
  if (transformer.origins !== undefined && !transformer.origins.includes(origin)) return false
  const mimeType = record.mimeType
  if (mimeType !== undefined) {
    return transformer.mimePrefixes.some((prefix) => mimeType.startsWith(prefix))
  }
  const extensions = transformer.filenameExtensions ?? []
  const lowerName = record.filename.toLowerCase()
  return extensions.some((ext) => lowerName.endsWith(ext.toLowerCase()))
}

const collapseWhitespace = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim()

const clean = (s: string): string => sanitizeForBracket(collapseWhitespace(s))

const formatDuration = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const labelFor = (record: Pick<PluginAttachmentRecord, 'attachmentId' | 'origin' | 'forwardedFrom'>): string => {
  if (record.forwardedFrom !== undefined) {
    return `Forwarded voice from "${sanitizeForBracket(record.forwardedFrom)}" ${record.attachmentId}`
  }
  if (record.origin === 'voice') return `Voice attachment ${record.attachmentId}`
  return `Attachment ${record.attachmentId}`
}

export function renderTransformLine(
  record: Pick<PluginAttachmentRecord, 'attachmentId' | 'filename' | 'origin' | 'forwardedFrom'>,
  result: AttachmentTransformResult,
): TransformLine {
  const label = labelFor(record)
  if (!result.ok) {
    return {
      line: `[${label}: transcription unavailable — ${clean(result.reason)}]`,
      historyLine: renderAttachedLine(record.attachmentId, record.filename),
    }
  }
  const metaParts: string[] = []
  if (result.meta?.durationSec !== undefined) metaParts.push(formatDuration(result.meta.durationSec))
  if (result.meta?.language !== undefined) metaParts.push(result.meta.language)
  const meta = metaParts.length === 0 ? '' : ` (${metaParts.join(', ')})`
  const text = clean(result.text)
  const truncated = text.length > HISTORY_TRANSCRIPT_MAX ? `${text.slice(0, HISTORY_TRANSCRIPT_MAX)}…` : text
  return {
    line: `[${label}${meta}: "${text}"]`,
    historyLine: `[User attached ${record.attachmentId}: ${sanitizeForBracket(record.filename)} — "${truncated}"]`,
  }
}

const clampTimeout = (timeoutMs: number | undefined): number => {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs))
}

/**
 * Execute a single attachment transformer with a bounded timeout.
 *
 * NOTE: the timeout does NOT cancel the in-flight transform — cancellation is
 * cooperative-only. If the transform does not honour cancellation signals, the
 * plugin call may keep running (and holding its runtime context) after this
 * function returns the failure line.
 */
export async function executeTransformer(
  transformer: PluginAttachmentTransformer,
  record: PluginAttachmentRecord,
  runtimeContext: PluginToolRuntimeContext,
): Promise<TransformLine> {
  const timeoutMs = clampTimeout(transformer.timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AttachmentTransformResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, reason: 'transformation timed out' })
    }, timeoutMs)
  })
  // Capture the promise before racing so we can attach a suppression handler.
  // If the timeout wins, the transform promise may still reject later; without
  // this handler that would become an unhandled rejection.
  const transformPromise = transformer.transform(record, runtimeContext)
  transformPromise.catch(() => {
    // Late rejection after the timeout already produced a failure line; swallow.
  })
  try {
    const result = await Promise.race([transformPromise, timeout])
    return renderTransformLine(record, result)
  } catch (error) {
    log.warn(
      {
        transformer: transformer.name,
        attachmentId: record.attachmentId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Attachment transformer threw',
    )
    return renderTransformLine(record, { ok: false, reason: 'transformation failed' })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const toPluginRecord = (stored: StoredAttachment): PluginAttachmentRecord => ({
  attachmentId: stored.attachmentId,
  filename: stored.filename,
  mimeType: stored.mimeType,
  size: stored.size,
  createdAt: stored.createdAt,
  ...(stored.origin === undefined ? {} : { origin: stored.origin }),
  ...(stored.forwardedFrom === undefined ? {} : { forwardedFrom: stored.forwardedFrom }),
})

type ContextTransformer = {
  pluginId: string
  manifest: PluginManifest
  transformer: PluginAttachmentTransformer
}

const collectContextTransformers = (contextId: string): ContextTransformer[] => {
  const plugins = [...getPluginsForContext(contextId)].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  const out: ContextTransformer[] = []
  for (const plugin of plugins) {
    const contributions = contributionRegistry.getContributions(plugin.manifest.id)
    if (contributions === undefined) continue
    for (const transformer of contributions.attachmentTransformers) {
      out.push({ pluginId: plugin.manifest.id, manifest: plugin.manifest, transformer })
    }
  }
  return out
}

/**
 * Returns true if there is at least one active attachment transformer registered
 * for the given context. Cheap check used as a fast-path guard.
 */
export function hasContextTransformers(contextId: string): boolean {
  return collectContextTransformers(contextId).length > 0
}

/**
 * Transform new attachments for the current turn. Returns a map keyed by
 * attachmentId with the live manifest line and the persisted-history line.
 * Failures never throw: every error converges on a failure marker line.
 *
 * A wall-clock budget of MAX_TIMEOUT_MS (120 s) covers the entire batch so
 * N slow transforms cannot stall a turn for N × per-record timeout. Records
 * whose turn is reached after the deadline are skipped with a failure line
 * instead of being dispatched. The optional `nowFn` param overrides
 * Date.now() for deterministic testing.
 */
export async function transformNewAttachments(
  contextId: string,
  chatUserId: string,
  records: readonly StoredAttachment[],
  nowFn: () => number = Date.now,
): Promise<Map<string, TransformLine>> {
  const result = new Map<string, TransformLine>()
  if (records.length === 0) return result
  const transformers = collectContextTransformers(contextId)
  if (transformers.length === 0) return result

  const deadline = nowFn() + MAX_TIMEOUT_MS

  await records.reduce(async (chain, stored) => {
    await chain
    const record = toPluginRecord(stored)
    const matched = transformers.find((entry) => matchesTransformer(entry.transformer, record))
    if (matched === undefined) return
    // Wall-clock budget guard: if the deadline has passed, skip dispatch and
    // return a failure line rather than stalling the turn further.
    if (nowFn() >= deadline) {
      result.set(stored.attachmentId, renderTransformLine(record, { ok: false, reason: 'transformation timed out' }))
      return
    }
    const runtimeContext = buildPluginToolRuntimeContext(matched.pluginId, matched.manifest, {
      storageContextId: contextId,
      chatUserId,
    })
    result.set(stored.attachmentId, await executeTransformer(matched.transformer, record, runtimeContext))
  }, Promise.resolve())
  return result
}
