// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { callNerv, NOT_CONFIGURED, readNervConfig } from './client.js'
import type { AdminConfigReader, HttpFetch } from './client.js'

type Reply = { text(s: string): Promise<void> | void }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAdminAuth(auth: unknown): boolean {
  return isRecord(auth) && (auth['isBotAdmin'] === true || auth['isGroupAdmin'] === true)
}

function storageContextIdOf(auth: unknown): string | null {
  if (!isRecord(auth)) return null
  const v = auth['storageContextId']
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Extracts the command's argument text (e.g. `bind foo/bar`) from a plugin command message. */
export function commandArgOf(message: unknown): string {
  if (!isRecord(message)) return ''
  const v = message['commandMatch']
  return typeof v === 'string' ? v.trim() : ''
}

/** Parses `bind <projectPath>` from a command argument string; null when it doesn't match. */
export function parseBindPath(arg: string): string | null {
  const match = /^bind\s+(\S+)$/u.exec(arg)
  return match?.[1] ?? null
}

/** Runs the admin-gated `/nerv bind <projectPath>` flow and replies with the outcome. */
export async function handleBindCommand(
  reply: Reply,
  auth: unknown,
  adminConfig: AdminConfigReader,
  httpFetch: HttpFetch | undefined,
  projectPath: string,
): Promise<void> {
  if (!isAdminAuth(auth)) {
    await reply.text('Only bot or group admins can bind this channel to a nerv project.')
    return
  }
  const storageContextId = storageContextIdOf(auth)
  if (storageContextId === null) {
    await reply.text('Could not determine this conversation’s context id.')
    return
  }
  const cfg = readNervConfig(adminConfig)
  if (cfg === null || httpFetch === undefined) {
    await reply.text(NOT_CONFIGURED.message)
    return
  }
  const result = await callNerv(httpFetch, cfg, 'POST', '/projects/bind', {
    projectPath,
    notifyContextId: storageContextId,
  })
  if (isRecord(result) && result['error'] === 'nerv_error') {
    if (result['status'] === 404) {
      await reply.text(`Unknown nerv project: \`${projectPath}\`. Check the path and try again.`)
      return
    }
    await reply.text(`Failed to bind \`${projectPath}\`: nerv returned an error.`)
    return
  }
  await reply.text(`Bound \`${projectPath}\` → this channel.`)
}
