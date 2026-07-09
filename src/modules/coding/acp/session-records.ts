// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asObject, optionalString } from './client.js'
import { deriveTitle, parsePrNumber, readRecord, writeRecord } from './history.js'
import type { RuntimeContext } from './tools.js'
import { sessionIdOf, shareFieldsOf } from './tools.js'

export function recordStartedSession(
  runtimeContext: RuntimeContext,
  result: unknown,
  project: string,
  prompt: string,
  prNumber?: number,
): void {
  const id = sessionIdOf(result)
  if (id !== null)
    writeRecord(runtimeContext.kv, id, {
      project,
      title: prNumber === undefined ? deriveTitle(prompt) : `PR #${prNumber}: ${deriveTitle(prompt)}`,
      createdAt: new Date().toISOString(),
      ...(prNumber === undefined ? {} : { prNumber }),
      ...shareFieldsOf(result),
    })
}

// Merge the locally-known title/parentSessionId into a magi session row, and
// refresh the local record's status/prUrl/prNumber from magi's latest view.
export function enrichSession(runtimeContext: RuntimeContext, s: unknown): unknown {
  const sid = sessionIdOf(s)
  if (sid === null) return s
  const row = asObject(s)
  const prUrl = optionalString(row, 'prUrl')
  const prNumber = parsePrNumber(prUrl)
  const record = readRecord(runtimeContext.kv, sid)
  if (record !== null) {
    writeRecord(runtimeContext.kv, sid, {
      ...record,
      status: optionalString(row, 'status') ?? record.status,
      ...(prUrl === undefined ? {} : { prUrl }),
      ...(prNumber === undefined ? {} : { prNumber }),
    })
  }
  return {
    ...row,
    ...(record === null
      ? {}
      : {
          title: record.title,
          parentSessionId: record.parentSessionId,
          ...(record.transcriptUrl === undefined ? {} : { transcriptUrl: record.transcriptUrl }),
        }),
    ...(prNumber === undefined ? {} : { prNumber }),
  }
}
