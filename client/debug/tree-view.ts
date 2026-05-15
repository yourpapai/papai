// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />

/**
 * Generates a collapsible tree view HTML for nested objects and arrays.
 */

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getValueType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${escapeHtml(value)}"`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function formatKeyPrefix(key: string | undefined): string {
  if (key === undefined) return ''
  return `${escapeHtml(key)}: `
}

function formatKeyHtmlPrefix(key: string | undefined): string {
  if (key === undefined) return ''
  return `<span class="tree-key">${escapeHtml(key)}: </span>`
}

type TreeEntry = {
  key: string
  value: unknown
  isLast: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getEntries(value: unknown, type: string): TreeEntry[] {
  if (type === 'array' && Array.isArray(value)) {
    return value.map((v: unknown, i) => ({
      key: String(i),
      value: v,
      isLast: i === value.length - 1,
    }))
  }

  if (type === 'object' && isPlainObject(value)) {
    const entries = Object.entries(value)
    return entries.map(([k, v], i) => ({
      key: k,
      value: v,
      isLast: i === entries.length - 1,
    }))
  }

  return []
}

function renderChildren(
  entries: TreeEntry[],
  toggleId: string,
  bracketOpen: string,
  bracketClose: string,
  indent: string,
  depth: number,
): string {
  let html = ''

  // Toggle button and opening bracket on same line
  html += `<span class="tree-toggle" data-target="${toggleId}" tabindex="0">▼</span>`
  html += `<span class="tree-bracket">${bracketOpen}</span>`

  // Collapsible content
  html += `<span class="tree-children" id="${toggleId}">`
  html += '\n'

  for (const entry of entries) {
    html += indent + '  '
    html += renderTreeView(entry.value, entry.key, depth + 1, entry.isLast)
    html += '\n'
  }

  html += indent
  html += `</span><span class="tree-bracket">${bracketClose}</span>`

  return html
}

/**
 * Renders a collapsible tree view for any value.
 * Returns HTML string.
 */
export function renderTreeView(value: unknown, key?: string, depth = 0, _isLast = true): string {
  const indent = '  '.repeat(depth)
  const type = getValueType(value)
  const hasChildren = type === 'object' || type === 'array'

  // Collapsible content for objects/arrays
  if (hasChildren && value !== null) {
    const entries = getEntries(value, type)

    const isEmpty = entries.length === 0
    const bracketOpen = type === 'array' ? '[' : '{'
    const bracketClose = type === 'array' ? ']' : '}'

    if (isEmpty) {
      // Empty object/array - no toggle needed
      const prefix = formatKeyPrefix(key)
      return `<span class="tree-key">${prefix}</span><span class="tree-bracket">${bracketOpen}${bracketClose}</span>`
    }

    // Generate unique ID for this toggle
    const toggleId = `tree-${Math.random().toString(36).slice(2)}`

    let html = ''

    // Key name and opening bracket
    html += formatKeyHtmlPrefix(key)

    // Render children
    html += renderChildren(entries, toggleId, bracketOpen, bracketClose, indent, depth)

    return html
  }

  // Primitive value
  const prefix = formatKeyHtmlPrefix(key)
  const valueClass = `tree-${type}`
  return `${prefix}<span class="${valueClass}">${formatPrimitive(value)}</span>`
}

/**
 * Renders all properties of an object as a tree view table.
 */
export function renderPropertiesTree(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj)
  if (entries.length === 0) return '<p class="tree-empty">No properties</p>'

  let html = '<div class="tree-container">'
  html += '<table class="tree-table">'

  for (const [key, value] of entries) {
    const type = getValueType(value)
    const hasChildren = (type === 'object' || type === 'array') && value !== null

    html += '<tr>'
    html += `<td class="tree-key-cell">${escapeHtml(key)}</td>`
    html += '<td class="tree-value-cell">'

    if (hasChildren) {
      html += renderTreeView(value, undefined, 0, true)
    } else {
      const valueClass = `tree-${type}`
      html += `<span class="${valueClass}">${formatPrimitive(value)}</span>`
    }

    html += '</td>'
    html += '</tr>'
  }

  html += '</table>'
  html += '</div>'

  return html
}
