// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface RagDocument {
  document_id?: string
  title?: string
  source?: string
  source_type?: string
  url?: string
}

export interface RagFailure {
  contextCode: string
  error: string
}

export function parseContextCodes(raw: string): string[] {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function parseSources(raw: string | undefined): string[] {
  if (raw === undefined || raw.length === 0) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function dedupeDocuments(docs: RagDocument[]): RagDocument[] {
  const seen = new Set<string>()
  const out: RagDocument[] = []
  for (const doc of docs) {
    const key = doc.document_id ?? doc.url
    if (key === undefined) {
      out.push(doc)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(doc)
  }
  return out
}

function formatDocumentEntry(doc: RagDocument, index: number): string {
  const lines: string[] = [`${index + 1}. ${doc.title ?? '(untitled)'}`, `   ${doc.url ?? doc.document_id ?? ''}`]
  if (doc.source !== undefined || doc.source_type !== undefined) {
    lines.push(`   source: ${doc.source ?? ''}/${doc.source_type ?? ''}`)
  }
  return lines.join('\n')
}

export function formatDocuments(docs: RagDocument[]): string {
  if (docs.length === 0) return 'No documents found.'
  const entries = docs.map((doc, index) => formatDocumentEntry(doc, index))
  return `Found ${docs.length} documents:\n\n${entries.join('\n\n')}`
}

export function formatFailures(failures: RagFailure[]): string {
  if (failures.length === 0) return ''
  return `⚠️ Failed to query contexts: ${failures.map((f) => `${f.contextCode} (${f.error})`).join('; ')}`
}
