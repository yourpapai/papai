// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const PREVIEW_HEADER_RE = /^\s*###\s*Auto-decision preview\s*$/u
const HEADER_RE = /^\s*(?:##|###)\s+/u

/**
 * Strip the `### Auto-decision preview` section (from its header to the next
 * `## `/`### ` header or EOF) before processing, so a hand-mangled preview
 * can never become gate input — the parse-inert guarantee's second layer.
 */
export function stripPreviewSection(markdown: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => PREVIEW_HEADER_RE.test(line))
  if (start === -1) return markdown
  const end = lines.findIndex((line, index) => index > start && HEADER_RE.test(line))
  const kept = end === -1 ? lines.slice(0, start) : [...lines.slice(0, start), ...lines.slice(end)]
  return kept.join('\n')
}
