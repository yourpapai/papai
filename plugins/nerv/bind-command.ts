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

/** Outcome of parsing a `/nerv` command argument for the `bind` subcommand. */
export type BindParse = { kind: 'not-bind' } | { kind: 'usage-error' } | { kind: 'path'; path: string }

const BIND_SUBCOMMAND = /^bind(?:\s|$)/u
const BIND_WITH_PATH = /^bind\s+(\S+)$/u

/**
 * Parses `bind <projectPath>` from a command argument string.
 * Returns `not-bind` when the argument isn't a `bind` subcommand at all, `usage-error` when it
 * is a `bind` attempt with a missing or malformed argument (no path, or extra tokens), and
 * `path` with the extracted project path otherwise.
 */
export function parseBindPath(arg: string): BindParse {
  if (!BIND_SUBCOMMAND.test(arg)) return { kind: 'not-bind' }
  const match = BIND_WITH_PATH.exec(arg)
  if (match?.[1] === undefined) return { kind: 'usage-error' }
  return { kind: 'path', path: match[1] }
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
