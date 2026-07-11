// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const ISSUE_LINK_FIELDS =
  'id,links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))'

export type FieldValue = string | number | boolean | null | Array<string | number>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (typeof value === 'symbol') return value.toString()
  return JSON.stringify(value) ?? ''
}

export function fieldTypeToValueType(type: string): string {
  if (type.includes('User')) return 'User'
  if (type.includes('Group')) return 'UserGroup'
  if (type.includes('State')) return 'StateBundleElement'
  if (type.includes('Version')) return 'VersionBundleElement'
  if (type.includes('Build')) return 'BuildBundleElement'
  if (type.includes('Owned')) return 'OwnedBundleElement'
  return 'EnumBundleElement'
}

export function buildCustomFieldValue(type: string, value: unknown): unknown {
  if (value === null) return null
  if (/Enum|State|Version|Build|Owned|Group|User/u.test(type)) {
    const vt = fieldTypeToValueType(type)
    const single = (v: unknown): { $type: string; login: string } | { $type: string; name: string } =>
      type.includes('User') ? { $type: vt, login: stringifyValue(v) } : { $type: vt, name: stringifyValue(v) }
    if (type.startsWith('Multi')) return Array.isArray(value) ? value.map(single) : [single(value)]
    return single(Array.isArray(value) ? value[0] : value)
  }
  if (type.includes('Period')) {
    return typeof value === 'number' ? { minutes: value } : { presentation: stringifyValue(value) }
  }
  if (type.includes('Text')) return { text: stringifyValue(value) }
  return value
}

export function linkMatches(link: unknown, linkType: string, direction: 'sourceToTarget' | 'targetToSource'): boolean {
  if (!isRecord(link)) return false
  const lt = link['linkType']
  if (!isRecord(lt)) return false
  const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '')
  const target = norm(linkType)
  return (
    target !== '' &&
    [lt[direction], lt['name'], lt['sourceToTarget'], lt['targetToSource']].some((cand) => norm(cand) === target)
  )
}

export function findIssueLink(
  links: unknown,
  linkType: string,
  direction: 'sourceToTarget' | 'targetToSource',
): { id: string } | undefined {
  if (!Array.isArray(links)) return undefined
  for (const link of links) {
    if (linkMatches(link, linkType, direction) && isRecord(link) && typeof link['id'] === 'string') {
      return { id: link['id'] }
    }
  }
  return undefined
}
