// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}

export type SessionRecord = {
  project: string
  title: string
  createdAt: string
  parentSessionId?: string
  prNumber?: number
  prUrl?: string
  status?: string
}

const KEY_PREFIX = 'session:'

export function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n').find((line): boolean => line.trim().length > 0)
  const title = firstLine === undefined ? '' : firstLine.trim()
  if (title.length === 0) return 'coding session'
  return title.length <= 120 ? title : `${title.slice(0, 119)}…`
}

export function parsePrNumber(prUrl: string | undefined): number | undefined {
  if (prUrl === undefined) return undefined
  const match = /(?:\/pull\/|\/merge_requests\/)(\d+)/u.exec(prUrl)
  if (match === null) return undefined
  const n = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function writeRecord(kv: KvStore, sessionId: string, record: SessionRecord): void {
  kv.set(`${KEY_PREFIX}${sessionId}`, JSON.stringify(record))
}

function toSessionRecord(parsed: object): SessionRecord | null {
  const fields = new Map<string, unknown>(Object.entries(parsed))
  const project = fields.get('project')
  const title = fields.get('title')
  const createdAt = fields.get('createdAt')
  const parentSessionId = fields.get('parentSessionId')
  const prNumber = fields.get('prNumber')
  const prUrl = fields.get('prUrl')
  const status = fields.get('status')
  if (typeof project !== 'string' || typeof title !== 'string' || typeof createdAt !== 'string') return null

  const result: SessionRecord = { project, title, createdAt }
  if (typeof parentSessionId === 'string') result.parentSessionId = parentSessionId
  if (typeof prNumber === 'number') result.prNumber = prNumber
  if (typeof prUrl === 'string') result.prUrl = prUrl
  if (typeof status === 'string') result.status = status
  return result
}

export function readRecord(kv: KvStore, sessionId: string): SessionRecord | null {
  const raw = kv.get(`${KEY_PREFIX}${sessionId}`)
  if (raw === undefined || raw === '1') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return toSessionRecord(parsed)
  } catch {
    return null
  }
}

export function listRecords(kv: KvStore): Array<{ id: string; record: SessionRecord }> {
  const out: Array<{ id: string; record: SessionRecord }> = []
  for (const row of kv.list(KEY_PREFIX)) {
    const id = row.key.slice(KEY_PREFIX.length)
    const record = readRecord(kv, id)
    if (record !== null) out.push({ id, record })
  }
  return out
}
