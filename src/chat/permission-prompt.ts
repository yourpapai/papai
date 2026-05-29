// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import type { ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:permission-prompt' })

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

export type PermissionDecision = 'allow' | 'deny'

interface PendingRequest {
  contextId: string
  toolName: string
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()

function generateRequestId(): string {
  return randomBytes(6).toString('base64url')
}

// CommonMark inline-disruptive punctuation. Backslash-escaping these neutralizes
// LLM-supplied reasons that attempt (accidentally or adversarially) to inject
// bold, italics, code spans, or links into the permission prompt.
const MARKDOWN_ESCAPE_PATTERN = /[\\`*_~[\]()]/gu

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_ESCAPE_PATTERN, (ch) => `\\${ch}`)
}

function formatPrompt(toolName: string, reason: string): string {
  return `🔐 Run \`${toolName}\`?\n\n${escapeMarkdown(reason)}`
}

export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string },
): Promise<PermissionDecision> {
  const id = generateRequestId()
  const body = formatPrompt(req.toolName, req.reason)
  await reply.buttons(body, {
    buttons: [
      { text: '✅ Allow', callbackData: `perm:a:${id}`, style: 'primary' },
      { text: '🚫 Deny', callbackData: `perm:d:${id}`, style: 'secondary' },
    ],
  })
  return new Promise<PermissionDecision>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id)
      if (entry === undefined) return
      pending.delete(id)
      log.warn({ contextId, toolName: req.toolName, id }, 'Permission prompt timed out; denying')
      entry.resolve('deny')
    }, PERMISSION_TIMEOUT_MS)
    pending.set(id, { contextId, toolName: req.toolName, resolve, timer })
  })
}

export function resolvePermissionRequest(id: string, decision: PermissionDecision): boolean {
  const entry = pending.get(id)
  if (entry === undefined) return false
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve(decision)
  return true
}

export function peekPermissionRequest(id: string): { contextId: string; toolName: string } | null {
  const entry = pending.get(id)
  if (entry === undefined) return null
  return { contextId: entry.contextId, toolName: entry.toolName }
}

export function resetPermissionPromptForTesting(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
}
