// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface SimplifiedSpace {
  key: string | undefined
  name: string | undefined
}

export interface SimplifiedStorage {
  value: string | undefined
  representation: string | undefined
}

export interface SimplifiedBody {
  storage: SimplifiedStorage
}

export interface SimplifiedPage {
  id?: string
  type?: string
  title?: string
  space?: SimplifiedSpace
  body?: SimplifiedBody
}

export interface SimplifiedComment {
  id?: string
  type?: string
  title?: string
  body?: SimplifiedBody
}

export interface SimplifiedComments {
  results: SimplifiedComment[]
  size?: unknown
  limit?: unknown
  start?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function simplifySpace(space: unknown): SimplifiedSpace | undefined {
  if (!isRecord(space)) return undefined
  return { key: stringOr(space['key']), name: stringOr(space['name']) }
}

function simplifyBody(body: unknown): SimplifiedBody | undefined {
  if (!isRecord(body)) return undefined
  const storage = body['storage']
  if (!isRecord(storage)) return undefined
  return {
    storage: { value: stringOr(storage['value']), representation: stringOr(storage['representation']) },
  }
}

function simplifyCore(input: Record<string, unknown>): { id?: string; type?: string; title?: string } {
  const out: { id?: string; type?: string; title?: string } = {}
  const id = stringOr(input['id'])
  if (id !== undefined) out.id = id
  const type = stringOr(input['type'])
  if (type !== undefined) out.type = type
  const title = stringOr(input['title'])
  if (title !== undefined) out.title = title
  return out
}

export function simplifyPage(page: unknown): SimplifiedPage {
  if (!isRecord(page)) return {}
  const out: SimplifiedPage = { ...simplifyCore(page) }
  const space = simplifySpace(page['space'])
  if (space !== undefined) out.space = space
  const body = simplifyBody(page['body'])
  if (body !== undefined) out.body = body
  return out
}

export function simplifyComment(comment: unknown): SimplifiedComment {
  if (!isRecord(comment)) return {}
  const out: SimplifiedComment = { ...simplifyCore(comment) }
  const body = simplifyBody(comment['body'])
  if (body !== undefined) out.body = body
  return out
}

export function simplifyComments(resp: unknown): SimplifiedComments {
  if (!isRecord(resp)) return { results: [] }
  const rawResults = resp['results']
  const results = Array.isArray(rawResults) ? rawResults.map((item) => simplifyComment(item)) : []
  const out: SimplifiedComments = { results }
  if ('size' in resp) out.size = resp['size']
  if ('limit' in resp) out.limit = resp['limit']
  if ('start' in resp) out.start = resp['start']
  return out
}
