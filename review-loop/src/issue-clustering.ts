// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { LedgerIssueRecord } from './issue-ledger.js'

export interface Cluster {
  id: string
  records: LedgerIssueRecord[]
}

const kindRank = (record: LedgerIssueRecord): number => (record.issue.kind === 'cleanup' ? 1 : 0)

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/\W+/u)
      .filter((w) => w.length > 2),
  )
}

function sharedTokenCount(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  let c = 0
  for (const w of ta) if (tb.has(w)) c += 1
  return c
}

function sameTheme(a: LedgerIssueRecord, b: LedgerIssueRecord): boolean {
  if (a.issue.kind !== b.issue.kind) return false
  // Theme issues already handled as singletons; this is for flat issues
  // Heuristic: share at least 2 meaningful tokens in title
  return sharedTokenCount(a.issue.title, b.issue.title) >= 2
}

export function clusterRecords(pending: readonly LedgerIssueRecord[]): Cluster[] {
  if (pending.length === 0) return []

  // Kind-first ordering preserved: sort stable by kindRank
  const sorted = [...pending].sort((x, y) => kindRank(x) - kindRank(y))

  const clusters: Cluster[] = []
  for (const record of sorted) {
    const isTheme = record.issue.spans !== undefined && record.issue.spans.length > 1
    if (isTheme) {
      clusters.push({ id: `theme-${record.id}`, records: [record] })
      continue
    }
    // Try to find existing non-theme cluster of same kind with shared n-gram
    let placed = false
    for (const cluster of clusters) {
      if (cluster.records.length === 0) continue
      // Don't merge into a theme cluster
      const isClusterTheme = cluster.records[0]!.issue.spans !== undefined && cluster.records[0]!.issue.spans.length > 1
      if (isClusterTheme) continue
      if (cluster.records[0]!.issue.kind !== record.issue.kind) continue
      // Check if this record shares theme with the cluster representative
      if (sameTheme(cluster.records[0]!, record)) {
        cluster.records.push(record)
        placed = true
        break
      }
    }
    if (!placed) {
      clusters.push({ id: `cluster-${record.id}`, records: [record] })
    }
  }

  // Ensure kind-first ordering across clusters (already sorted input, but
  // merging could interleave if we appended theme clusters out of order; re-sort stable)
  clusters.sort((a, b) => kindRank(a.records[0]!) - kindRank(b.records[0]!))

  return clusters
}
