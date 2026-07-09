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

export type TaskRecord = {
  taskId: string
  storageContextId: string
  title: string
  repos: string[]
  createdAt: string
  status?: string
  mrUrl?: string
  usageUsd?: number
}

const TASK_PREFIX = 'task:'
const ACTIVE_PREFIX = 'active:'
const TERMINAL = new Set(['completed', 'closed', 'failed'])

export function isTerminal(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status)
}

export function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n').find((line): boolean => line.trim().length > 0)
  const title = firstLine === undefined ? '' : firstLine.trim()
  if (title.length === 0) return 'coding task'
  return title.length <= 120 ? title : `${title.slice(0, 119)}…`
}

export function writeRecord(kv: KvStore, taskId: string, record: TaskRecord): void {
  kv.set(`${TASK_PREFIX}${taskId}`, JSON.stringify(record))
}

function toTaskRecord(parsed: object): TaskRecord | null {
  const fields = new Map<string, unknown>(Object.entries(parsed))
  const taskId = fields.get('taskId')
  const storageContextId = fields.get('storageContextId')
  const title = fields.get('title')
  const createdAt = fields.get('createdAt')
  const repos = fields.get('repos')
  if (typeof taskId !== 'string' || typeof storageContextId !== 'string') return null
  if (typeof title !== 'string' || typeof createdAt !== 'string') return null

  const record: TaskRecord = {
    taskId,
    storageContextId,
    title,
    createdAt,
    repos: Array.isArray(repos) ? repos.filter((r): r is string => typeof r === 'string') : [],
  }
  const status = fields.get('status')
  const mrUrl = fields.get('mrUrl')
  const usageUsd = fields.get('usageUsd')
  if (typeof status === 'string') record.status = status
  if (typeof mrUrl === 'string') record.mrUrl = mrUrl
  if (typeof usageUsd === 'number') record.usageUsd = usageUsd
  return record
}

export function readRecord(kv: KvStore, taskId: string): TaskRecord | null {
  const raw = kv.get(`${TASK_PREFIX}${taskId}`)
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return toTaskRecord(parsed)
  } catch {
    return null
  }
}

export function listRecords(kv: KvStore): TaskRecord[] {
  return kv
    .list(TASK_PREFIX)
    .map((row): TaskRecord | null => {
      try {
        const parsed: unknown = JSON.parse(row.value)
        return typeof parsed === 'object' && parsed !== null ? toTaskRecord(parsed) : null
      } catch {
        return null
      }
    })
    .filter((r): r is TaskRecord => r !== null)
}

export function setActive(kv: KvStore, storageContextId: string, taskId: string): void {
  kv.set(`${ACTIVE_PREFIX}${storageContextId}`, taskId)
}

export function getActiveTaskId(kv: KvStore, storageContextId: string): string | null {
  const value = kv.get(`${ACTIVE_PREFIX}${storageContextId}`)
  return value !== undefined && value.length > 0 ? value : null
}

export function clearActive(kv: KvStore, storageContextId: string): void {
  kv.delete(`${ACTIVE_PREFIX}${storageContextId}`)
}
