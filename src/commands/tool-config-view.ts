// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatButton } from '../chat/types.js'
import { getToolMetadata, type ToolDomain, type ToolRisk } from '../tools/tool-metadata.js'
import {
  getDomainSummary,
  resolveToolPermission,
  type DomainSummary,
  type Permission,
  type ToolPrefs,
} from '../tools/tool-preferences.js'

export interface ToolMenuView {
  text: string
  buttons: ChatButton[]
}

function encodeCtx(contextId: string): string {
  return Buffer.from(contextId).toString('base64url')
}

const DOMAIN_LABELS: Record<ToolDomain, string> = {
  task: 'Tasks',
  project: 'Projects',
  comment: 'Comments',
  label: 'Labels',
  status: 'Statuses',
  attachment: 'Attachments',
  work: 'Work logs',
  sprint: 'Sprints',
  query: 'Saved queries',
  collaboration: 'Collaboration',
  memo: 'Memos',
  recurring: 'Recurring tasks',
  deferred: 'Deferred prompts',
  instruction: 'Instructions',
  history: 'History',
  web: 'Web fetch',
  identity: 'Identity',
  time: 'Time',
  mcp: 'MCP tools',
}

const RISK_EMOJI: Record<ToolRisk, string> = {
  read: '📖',
  write: '✏️',
  destructive: '⚠️',
  'open-world': '🌐',
}

const MAX_CALLBACK_DATA_BYTES = 64
const DOMAIN_CODES: readonly ToolDomain[] = [
  'task',
  'project',
  'comment',
  'label',
  'status',
  'attachment',
  'work',
  'sprint',
  'query',
  'collaboration',
  'memo',
  'recurring',
  'deferred',
  'instruction',
  'history',
  'web',
  'identity',
  'time',
]

function callbackData(raw: string, compact: string): string | null {
  if (Buffer.byteLength(raw, 'utf8') <= MAX_CALLBACK_DATA_BYTES) return raw
  return Buffer.byteLength(compact, 'utf8') <= MAX_CALLBACK_DATA_BYTES ? compact : null
}

function callbackDataRawOnly(raw: string): string | null {
  return Buffer.byteLength(raw, 'utf8') <= MAX_CALLBACK_DATA_BYTES ? raw : null
}

function sortedToolNames(availableToolNames: readonly string[]): string[] {
  return [...availableToolNames].filter((name) => getToolMetadata(name) !== undefined).toSorted()
}

function domainCode(domain: ToolDomain): string {
  return DOMAIN_CODES.indexOf(domain).toString(36)
}

export function resolveToolDomainCode(code: string): ToolDomain | null {
  const index = Number.parseInt(code, 36)
  if (!Number.isSafeInteger(index)) return null
  return DOMAIN_CODES[index] ?? null
}

export function resolveToolNameCode(code: string, availableToolNames: readonly string[]): string | null {
  const index = Number.parseInt(code, 36)
  if (!Number.isSafeInteger(index)) return null
  return sortedToolNames(availableToolNames)[index] ?? null
}

function groupByDomain(availableToolNames: readonly string[]): Map<ToolDomain, string[]> {
  const map = new Map<ToolDomain, string[]>()
  for (const name of availableToolNames) {
    const meta = getToolMetadata(name)
    if (meta === undefined) continue
    const existing = map.get(meta.domain)
    if (existing === undefined) {
      map.set(meta.domain, [name])
    } else {
      existing.push(name)
    }
  }
  return map
}

function summaryMarker(summary: DomainSummary): string {
  if (summary === 'allow') return '🟢'
  if (summary === 'ask') return '❓'
  if (summary === 'deny') return '⭕'
  return '🟡'
}

function permissionMarker(perm: Permission): string {
  if (perm === 'allow') return '🟢'
  if (perm === 'ask') return '❓'
  return '⭕'
}

export function buildDomainListView(
  contextId: string,
  availableToolNames: readonly string[],
  prefs: ToolPrefs,
): ToolMenuView {
  const ctx = encodeCtx(contextId)
  const grouped = groupByDomain(availableToolNames)
  const domains = [...grouped.keys()].toSorted((a, b) => DOMAIN_LABELS[a].localeCompare(DOMAIN_LABELS[b]))
  const lines = ['🧰 **Tools** — tap a domain to cycle its permission, or "Edit" to pick individual tools.\n']
  const buttons: ChatButton[] = []
  for (const domain of domains) {
    const domainToolList = grouped.get(domain)
    let names: string[]
    if (domainToolList === undefined) {
      names = []
    } else {
      names = domainToolList
    }
    const summary = getDomainSummary(prefs, domain, names)
    lines.push(`${summaryMarker(summary)} ${DOMAIN_LABELS[domain]}`)
    const toggleCallback = callbackData(`tgl:dom:${domain}:${ctx}`, `tgl:d:${domainCode(domain)}:${ctx}`)
    if (toggleCallback !== null) {
      buttons.push({
        text: `${summaryMarker(summary)} ${DOMAIN_LABELS[domain]}`,
        callbackData: toggleCallback,
        style: summary === 'deny' ? 'secondary' : 'primary',
      })
    }
    const openCallback = callbackData(`tgl:open:${domain}:${ctx}`, `tgl:o:${domainCode(domain)}:${ctx}`)
    if (openCallback !== null) {
      buttons.push({
        text: `✏️ Edit ${DOMAIN_LABELS[domain]}`,
        callbackData: openCallback,
        style: 'secondary',
      })
    }
  }
  const externalNames = [...availableToolNames].filter((name) => getToolMetadata(name) === undefined)
  if (externalNames.length > 0) {
    lines.push(`🧩 External — ${externalNames.length} tools`)
    const editCallback = callbackData(`tgl:open:external:${ctx}`, `tgl:o:ext:${ctx}`)
    if (editCallback !== null) {
      buttons.push({ text: '✏️ Edit External', callbackData: editCallback, style: 'secondary' })
    }
  }
  lines.push('')
  lines.push('🟢 = always allowed   ❓ = ask each time   ⭕ = blocked')
  return { text: lines.join('\n'), buttons }
}

function buildExternalDrillView(ctx: string, availableToolNames: readonly string[], prefs: ToolPrefs): ToolMenuView {
  const sortedExt = [...availableToolNames].filter((n) => getToolMetadata(n) === undefined).toSorted()
  const lines = ['🧰 **External tools** — tap a tool to cycle its permission.\n']
  const buttons: ChatButton[] = []
  for (const name of sortedExt) {
    const perm = resolveToolPermission(prefs, name)
    lines.push(`${permissionMarker(perm)} ${name}`)
    const toolCallback = callbackDataRawOnly(`tgl:tool:${name}:${ctx}`)
    if (toolCallback !== null) {
      buttons.push({
        text: `${permissionMarker(perm)} ${name}`,
        callbackData: toolCallback,
        style: perm === 'deny' ? 'secondary' : 'primary',
      })
    }
  }
  const backCallback = callbackData(`tgl:back:${ctx}`, `tgl:b:${ctx}`)
  if (backCallback !== null) buttons.push({ text: '⬅️ Back', callbackData: backCallback, style: 'secondary' })
  return { text: lines.join('\n'), buttons }
}

function buildNamedDomainDrillView(
  ctx: string,
  domain: ToolDomain,
  availableToolNames: readonly string[],
  prefs: ToolPrefs,
): ToolMenuView {
  const domainTools = groupByDomain(availableToolNames).get(domain)
  const names = domainTools ?? []
  const sorted = [...names].toSorted()
  const allSorted = sortedToolNames(availableToolNames)
  const lines = [`🧰 **${DOMAIN_LABELS[domain]}** — tap a tool to cycle its permission.\n`]
  const buttons: ChatButton[] = []
  for (const name of sorted) {
    const meta = getToolMetadata(name)
    const risk = meta === undefined ? '' : RISK_EMOJI[meta.risk]
    const perm = resolveToolPermission(prefs, name)
    lines.push(`${permissionMarker(perm)} ${risk} ${name}`)
    const toolCallback = callbackData(`tgl:tool:${name}:${ctx}`, `tgl:t:${allSorted.indexOf(name).toString(36)}:${ctx}`)
    if (toolCallback !== null) {
      buttons.push({
        text: `${permissionMarker(perm)} ${risk} ${name}`,
        callbackData: toolCallback,
        style: perm === 'deny' ? 'secondary' : 'primary',
      })
    }
  }
  const backCallback = callbackData(`tgl:back:${ctx}`, `tgl:b:${ctx}`)
  if (backCallback !== null) buttons.push({ text: '⬅️ Back', callbackData: backCallback, style: 'secondary' })
  return { text: lines.join('\n'), buttons }
}

export function buildDomainDrillView(
  contextId: string,
  domain: ToolDomain | 'external',
  availableToolNames: readonly string[],
  prefs: ToolPrefs,
): ToolMenuView {
  const ctx = encodeCtx(contextId)
  if (domain === 'external') return buildExternalDrillView(ctx, availableToolNames, prefs)
  return buildNamedDomainDrillView(ctx, domain, availableToolNames, prefs)
}
