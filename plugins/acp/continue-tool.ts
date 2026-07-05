// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  asObject,
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  optionalString,
  readMagiConfig,
} from './client.js'
import type { HttpFetch, MagiConfig } from './client.js'
import { deriveTitle, parsePrNumber, readRecord, writeRecord } from './history.js'
import type { SessionRecord } from './history.js'
import { continueSessionSchema } from './schemas.js'
import type { RuntimeContext, Tool } from './tools.js'
import { sessionIdOf, shareFieldsOf } from './tools.js'

type AccessError = { error: string; message: string }
type AccessOk = { secrets: Record<string, string>; forgeToken: string }

function checkAccess(runtimeContext: RuntimeContext): AccessError | AccessOk {
  const secrets = runtimeContext.codingSecrets.resolve()
  if (secrets === null)
    return {
      error: 'not_configured',
      message:
        "You haven't set up your coding credentials. DM me and open settings → Coding sessions to configure your AI provider key (and code host).",
    }
  const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
  if (forgeToken === null)
    return {
      error: 'not_configured',
      message: 'Connect a code host in settings → Coding sessions before continuing a session.',
    }
  return { secrets, forgeToken }
}

// Find a locally-known parent session id for a PR number by asking magi for the
// done list and matching on prUrl (scoped to sessions this chat started).
async function resolveByPr(
  httpFetch: HttpFetch,
  cfg: MagiConfig,
  runtimeContext: RuntimeContext,
  prNumber: number,
  project: string | undefined,
): Promise<string | null> {
  const result = await callMagi(httpFetch, cfg, 'GET', '/sessions?filter=done')
  if (!Array.isArray(result)) return null
  for (const row of result) {
    const obj = asObject(row)
    const id = asString(obj, 'id')
    if (id === null || readRecord(runtimeContext.kv, id) === null) continue
    const prUrl = optionalString(obj, 'prUrl')
    if (parsePrNumber(prUrl) !== prNumber) continue
    if (project !== undefined && optionalString(obj, 'project') !== project) continue
    return id
  }
  return null
}

function resolveParentId(
  httpFetch: HttpFetch,
  cfg: MagiConfig,
  runtimeContext: RuntimeContext,
  args: Record<string, unknown>,
): Promise<string | null> {
  const sessionId = asString(args, 'sessionId')
  if (sessionId !== null) return Promise.resolve(sessionId)
  const prNumber = asPositiveInt(args, 'prNumber')
  if (prNumber === null) return Promise.resolve(null)
  const project = optionalString(args, 'project')
  return resolveByPr(httpFetch, cfg, runtimeContext, prNumber, project)
}

function buildChildRecord(parentId: string, parentRecord: SessionRecord, prompt: string): SessionRecord {
  return {
    project: parentRecord.project,
    title: deriveTitle(prompt),
    createdAt: new Date().toISOString(),
    parentSessionId: parentId,
    ...(parentRecord.prNumber === undefined ? {} : { prNumber: parentRecord.prNumber }),
    ...(parentRecord.prUrl === undefined ? {} : { prUrl: parentRecord.prUrl }),
  }
}

export function continueSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'continue_session',
    description:
      'Continue a prior coding session on its existing branch/PR with a new prompt. Identify the target by ' +
      'sessionId, or by prNumber (+project). Updates the existing PR instead of opening a new one.',
    inputSchema: continueSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const prompt = asString(args, 'prompt')
      if (prompt === null) return { error: 'invalid_input', message: 'prompt is required' }

      const access = checkAccess(runtimeContext)
      if ('error' in access) return access
      const { secrets, forgeToken } = access

      const parentId = await resolveParentId(httpFetch, cfg, runtimeContext, args)
      if (parentId === null)
        return {
          error: 'not_found',
          message: 'Could not find a prior session to continue. Provide a sessionId or a known PR number.',
        }
      const parentRecord = readRecord(runtimeContext.kv, parentId)
      if (parentRecord === null)
        return { error: 'not_found', message: `Session "${parentId}" is not one this chat started.` }

      const result = await callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(parentId)}/follow-up`, {
        prompt,
        secrets,
        forgeToken,
      })
      const childId = sessionIdOf(result)
      if (childId !== null)
        writeRecord(runtimeContext.kv, childId, {
          ...buildChildRecord(parentId, parentRecord, prompt),
          ...shareFieldsOf(result),
        })
      return result
    },
  }
}
