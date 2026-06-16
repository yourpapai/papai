// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import type { z } from 'zod'

import type { BundleElement, BundleElementFetcher } from './bundle-values.js'
import { YouTrackClassifiedError } from './classify-error.js'
import { parseDueDateValue } from './due-date.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

export interface IssueCustomFieldPayload {
  name: string
  $type: string
  value: unknown
}

export interface FieldClassification {
  label: string
  kind: 'bundle' | 'user' | 'text' | 'simple' | 'date' | 'period' | 'unknown'
  multi: boolean
  singleType?: string
  multiType?: string
  bundleSegment?: string
}

const ALLOWED_CAP = 50

interface TypeEntry {
  kind: FieldClassification['kind']
  label: string
  single: string
  multi: string
}

const TYPE_TABLE: Record<string, TypeEntry> = {
  enum: { kind: 'bundle', label: 'enum', single: 'SingleEnumIssueCustomField', multi: 'MultiEnumIssueCustomField' },
  state: { kind: 'bundle', label: 'state', single: 'StateIssueCustomField', multi: 'StateIssueCustomField' },
  version: {
    kind: 'bundle',
    label: 'version',
    single: 'SingleVersionIssueCustomField',
    multi: 'MultiVersionIssueCustomField',
  },
  ownedfield: {
    kind: 'bundle',
    label: 'ownedField',
    single: 'SingleOwnedIssueCustomField',
    multi: 'MultiOwnedIssueCustomField',
  },
  build: { kind: 'bundle', label: 'build', single: 'SingleBuildIssueCustomField', multi: 'MultiBuildIssueCustomField' },
  user: { kind: 'user', label: 'user', single: 'SingleUserIssueCustomField', multi: 'MultiUserIssueCustomField' },
  text: { kind: 'text', label: 'text', single: 'TextIssueCustomField', multi: 'TextIssueCustomField' },
  string: { kind: 'simple', label: 'string', single: 'SimpleIssueCustomField', multi: 'SimpleIssueCustomField' },
  integer: { kind: 'simple', label: 'integer', single: 'SimpleIssueCustomField', multi: 'SimpleIssueCustomField' },
  float: { kind: 'simple', label: 'float', single: 'SimpleIssueCustomField', multi: 'SimpleIssueCustomField' },
  date: { kind: 'date', label: 'date', single: 'DateIssueCustomField', multi: 'DateIssueCustomField' },
  'date and time': { kind: 'date', label: 'date', single: 'DateIssueCustomField', multi: 'DateIssueCustomField' },
  period: { kind: 'period', label: 'period', single: 'PeriodIssueCustomField', multi: 'PeriodIssueCustomField' },
}

const parseFieldTypeId = (id: string | undefined): { base: string; multi: boolean } => {
  const raw = (id ?? '').trim()
  const match = /^(.*)\[(1|\*)\]$/u.exec(raw)
  if (match !== null) {
    const base = match[1] ?? ''
    const qualifier = match[2] ?? ''
    return { base: base.trim().toLowerCase(), multi: qualifier === '*' }
  }
  return { base: raw.toLowerCase(), multi: false }
}

const BUNDLE_SEGMENTS: Record<string, string> = {
  EnumBundle: 'enum',
  StateBundle: 'state',
  VersionBundle: 'version',
  OwnedFieldBundle: 'ownedField',
  BuildBundle: 'build',
}

const bundleSegmentFromType = (bundleType: string | undefined): string | undefined =>
  bundleType === undefined ? undefined : BUNDLE_SEGMENTS[bundleType]

export const classifyFieldType = (field: Readonly<ProjectCustomField>): FieldClassification => {
  const { base, multi } = parseFieldTypeId(field.field?.fieldType?.id)
  const entry = TYPE_TABLE[base]
  if (entry === undefined) {
    return { label: base === '' ? 'unknown' : base, kind: 'unknown', multi }
  }
  return {
    label: entry.label,
    kind: entry.kind,
    multi,
    singleType: entry.single,
    multiType: entry.multi,
    bundleSegment: entry.kind === 'bundle' ? bundleSegmentFromType(field.bundle?.$type) : undefined,
  }
}

export const formatAllowed = (values: readonly string[]): string => {
  if (values.length <= ALLOWED_CAP) return values.join(', ')
  return `${values.slice(0, ALLOWED_CAP).join(', ')}, …and ${values.length - ALLOWED_CAP} more`
}

export const capAllowedValues = (values: readonly string[]): string[] => {
  if (values.length <= ALLOWED_CAP) return [...values]
  return [...values.slice(0, ALLOWED_CAP), `…and ${values.length - ALLOWED_CAP} more`]
}

const fieldError = (fieldName: string, message: string): YouTrackClassifiedError =>
  new YouTrackClassifiedError(message, providerError.validationFailed(fieldName, message))

export const normalize = (value: string): string => value.trim().toLocaleLowerCase()

const splitMulti = (raw: string, multi: boolean): string[] =>
  multi
    ? raw
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    : [raw]

const matchBundleValue = (fieldName: string, raw: string, elements: readonly BundleElement[]): string => {
  const target = normalize(raw)
  const matches = elements.filter(
    (e) => normalize(e.name) === target || (e.localizedName !== undefined && normalize(e.localizedName) === target),
  )
  const matched = matches[0]
  if (matches.length === 1 && matched !== undefined) return matched.name
  throw fieldError(
    fieldName,
    `Field "${fieldName}": "${raw}" is not a valid value. Allowed values: ${formatAllowed(elements.map((e) => e.name))}`,
  )
}

const issueType = (c: Readonly<FieldClassification>, fieldName: string): string => {
  const resolved = c.multi ? c.multiType : c.singleType
  if (resolved === undefined) throw fieldError(fieldName, `Field "${fieldName}" is misconfigured`)
  return resolved
}

export const resolveCustomFieldValue = async (
  field: Readonly<ProjectCustomField>,
  rawValue: string,
  ctx: Readonly<{ getBundleElements: BundleElementFetcher }>,
): Promise<IssueCustomFieldPayload> => {
  const name = field.field?.name
  if (name === undefined) throw fieldError('customFields', 'Custom field is missing a name')
  const c = classifyFieldType(field)
  switch (c.kind) {
    case 'text':
      return { name, $type: 'TextIssueCustomField', value: { text: rawValue } }
    case 'simple': {
      if (c.label === 'integer' || c.label === 'float') {
        const numeric = Number(rawValue)
        if (!Number.isFinite(numeric)) {
          throw fieldError(name, `Field "${name}" expects a number, got "${rawValue}"`)
        }
        return { name, $type: 'SimpleIssueCustomField', value: numeric }
      }
      return { name, $type: 'SimpleIssueCustomField', value: rawValue }
    }
    case 'date':
      return { name, $type: 'DateIssueCustomField', value: parseDueDateValue(rawValue) }
    case 'period':
      return { name, $type: 'PeriodIssueCustomField', value: { presentation: rawValue } }
    case 'user': {
      const logins = splitMulti(rawValue, c.multi).map((v) => ({ login: v }))
      return { name, $type: issueType(c, name), value: c.multi ? logins : logins[0] }
    }
    case 'bundle': {
      const segment = c.bundleSegment
      const bundleId = field.bundle?.id
      if (segment === undefined || bundleId === undefined) {
        throw fieldError(name, `Field "${name}" has no resolvable value set on this project`)
      }
      const elements = await ctx.getBundleElements(segment, bundleId)
      const resolved = splitMulti(rawValue, c.multi).map((v) => ({ name: matchBundleValue(name, v, elements) }))
      return { name, $type: issueType(c, name), value: c.multi ? resolved : resolved[0] }
    }
    case 'unknown':
      throw fieldError(
        name,
        `Field "${name}" has an unsupported type (${field.field?.fieldType?.id ?? 'unknown'}) for create_task`,
      )
  }
  throw new Error(`Unreachable: unhandled field kind`)
}
