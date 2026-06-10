// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolBrief } from './tool-brief.js'

export type RankedBrief = ToolBrief & { score: number }

export interface ToolRetriever {
  rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]>
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((tok) => tok.length > 1)
}

export class LexicalToolRetriever implements ToolRetriever {
  rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]> {
    const qTokens = new Set(tokenize(query))
    if (qTokens.size === 0) return Promise.resolve([])
    const qText = query.toLowerCase()
    const scored: RankedBrief[] = []
    for (const brief of briefs) {
      const haystack = `${brief.name} ${brief.summary} ${brief.domain}`.toLowerCase()
      const hTokens = tokenize(haystack)
      let overlap = 0
      for (const tok of hTokens) if (qTokens.has(tok)) overlap += 1
      const substringBonus = qText.length > 2 && haystack.includes(qText) ? 1 : 0
      const score = overlap + substringBonus
      scored.push({ ...brief, score })
    }
    const maxScore = scored.reduce((m, b) => (b.score > m ? b.score : m), 0)
    if (maxScore === 0) return Promise.resolve([])
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return Promise.resolve(scored.slice(0, limit))
  }
}
