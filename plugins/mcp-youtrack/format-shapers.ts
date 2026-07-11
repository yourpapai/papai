// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ShapedUser {
  login?: string
  fullName?: string
}

export interface ShapedTag {
  id?: string
  name?: string
}

export interface ShapedCustomField {
  name?: string
  value?: unknown
}

export interface ShapedLinkType {
  name?: string
  sourceToTarget?: string
  targetToSource?: string
}

export interface ShapedLinkIssue {
  id?: string
  idReadable?: string
  summary?: string
}

export interface ShapedLink {
  id?: string
  direction?: string
  linkType?: ShapedLinkType
  issues?: ShapedLinkIssue[]
}

export interface ShapedIssue {
  idReadable?: string
  summary?: string
  description?: string
  reporter?: ShapedUser
  tags?: ShapedTag[]
  customFields?: ShapedCustomField[]
  links?: ShapedLink[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function shapeUser(raw: unknown): ShapedUser | undefined {
  if (!isRecord(raw)) return undefined
  const login = stringOr(raw['login'])
  const fullName = stringOr(raw['fullName'])
  return {
    ...(login === undefined ? {} : { login }),
    ...(fullName === undefined ? {} : { fullName }),
  }
}

export function shapeFieldValue(v: unknown): unknown {
  if (v === null) return null
  if (Array.isArray(v)) return v.map((entry) => shapeFieldValue(entry))
  if (isRecord(v)) {
    const name = stringOr(v['name'])
    const login = stringOr(v['login'])
    const fullName = stringOr(v['fullName'])
    const text = stringOr(v['text'])
    return {
      ...(name === undefined ? {} : { name }),
      ...(login === undefined ? {} : { login }),
      ...(fullName === undefined ? {} : { fullName }),
      ...(text === undefined ? {} : { text }),
    }
  }
  return v
}

function shapeTag(raw: unknown): ShapedTag {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const name = stringOr(raw['name'])
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
  }
}

function shapeCustomField(raw: unknown): ShapedCustomField {
  if (!isRecord(raw)) return {}
  const name = stringOr(raw['name'])
  return {
    ...(name === undefined ? {} : { name }),
    value: shapeFieldValue(raw['value']),
  }
}

function shapeLinkType(raw: unknown): ShapedLinkType | undefined {
  if (!isRecord(raw)) return undefined
  const name = stringOr(raw['name'])
  const sourceToTarget = stringOr(raw['sourceToTarget'])
  const targetToSource = stringOr(raw['targetToSource'])
  return {
    ...(name === undefined ? {} : { name }),
    ...(sourceToTarget === undefined ? {} : { sourceToTarget }),
    ...(targetToSource === undefined ? {} : { targetToSource }),
  }
}

function shapeLinkIssue(raw: unknown): ShapedLinkIssue {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const idReadable = stringOr(raw['idReadable'])
  const summary = stringOr(raw['summary'])
  return {
    ...(id === undefined ? {} : { id }),
    ...(idReadable === undefined ? {} : { idReadable }),
    ...(summary === undefined ? {} : { summary }),
  }
}

function shapeLink(raw: unknown): ShapedLink {
  if (!isRecord(raw)) return {}
  const id = stringOr(raw['id'])
  const direction = stringOr(raw['direction'])
  const linkType = shapeLinkType(raw['linkType'])
  const issuesRaw = raw['issues']
  const issues = Array.isArray(issuesRaw) ? issuesRaw.map((entry) => shapeLinkIssue(entry)) : undefined
  return {
    ...(id === undefined ? {} : { id }),
    ...(direction === undefined ? {} : { direction }),
    ...(linkType === undefined ? {} : { linkType }),
    ...(issues === undefined ? {} : { issues }),
  }
}

export function shapeIssue(raw: unknown): ShapedIssue {
  if (!isRecord(raw)) return {}
  const idReadable = stringOr(raw['idReadable'])
  const summary = stringOr(raw['summary'])
  const description = stringOr(raw['description'])
  const reporter = shapeUser(raw['reporter'])
  const tagsRaw = raw['tags']
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map((entry) => shapeTag(entry)) : undefined
  const customFieldsRaw = raw['customFields']
  const customFields = Array.isArray(customFieldsRaw)
    ? customFieldsRaw.map((entry) => shapeCustomField(entry))
    : undefined
  const linksRaw = raw['links']
  const links = Array.isArray(linksRaw) ? linksRaw.map((entry) => shapeLink(entry)) : undefined

  return {
    ...(idReadable === undefined ? {} : { idReadable }),
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
    ...(reporter === undefined ? {} : { reporter }),
    ...(tags === undefined ? {} : { tags }),
    ...(customFields === undefined ? {} : { customFields }),
    ...(links === undefined ? {} : { links }),
  }
}
