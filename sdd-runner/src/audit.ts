// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { readEvents } from './events.js'
import { loadRunState } from './run-state.js'

interface DebtEntry {
  readonly ts: string
  readonly runId?: string
  readonly gateVersion?: number
  readonly rule: string
  readonly evidenceDigest: string
}

/**
 * `sdd-runner audit <runId>` (D9): walk the run's `auto_decision` events and
 * render the reconsider list — per real decision (`approve`/`extend`/
 * `accept-items` only; `preview`/`gate`/`none` records excluded) the rule,
 * the evidence digest, and the copy-pasteable overturn command. The
 * policy-debt ledger is read-only here (the gate seam is the single writer),
 * reported with `(rule, hash(evidenceDigest))` dedupe + count.
 */
export async function buildAuditReport(workDir: string, runId: string): Promise<string> {
  const state = await loadRunState(workDir, runId)
  const events = readEvents(path.join(workDir, 'runs', runId, 'events.ndjson'))
  const decisions = events.filter(
    (event) =>
      event.type === 'auto_decision' &&
      (event.decision === 'approve' || event.decision === 'extend' || event.decision === 'accept-items'),
  )
  const lines: string[] = [`audit: run ${runId} (change ${state.changeName})`, '']
  if (decisions.length === 0) {
    lines.push('no auto-decisions to reconsider')
  } else {
    lines.push('## Reconsider list', '')
    for (const decision of decisions) {
      if (decision.type !== 'auto_decision') continue
      lines.push(
        `- rule ${decision.rule} · ${decision.decision} · evidence ${decision.evidenceDigest} · gate v${decision.gateVersion}`,
      )
      lines.push(
        `  sdd-runner gate reopen ${runId} --gate ${decision.gateVersion} && sdd-runner gate resume ${runId} --confirm-all --veto <id>=<redirect>`,
      )
      lines.push('  (or --abort)')
    }
  }
  const debt = await readDebtLedger(path.join(workDir, 'policy-debt.jsonl'))
  if (debt.length > 0) {
    lines.push('', '## Policy debt (deduped by rule + evidence hash)')
    const counts = new Map<string, { rule: string; count: number }>()
    for (const entry of debt) {
      const key = `${entry.rule}:${hashOf(entry.evidenceDigest)}`
      const current = counts.get(key)
      counts.set(key, { rule: entry.rule, count: (current?.count ?? 0) + 1 })
    }
    for (const { rule, count } of counts.values()) {
      lines.push(`- policy debt ${rule} × ${count}`)
    }
  }
  return lines.join('\n')
}

const DebtEntrySchema = z.object({
  ts: z.string().default(''),
  runId: z.string().optional(),
  gateVersion: z.number().optional(),
  rule: z.string(),
  evidenceDigest: z.string(),
})

function parseDebtEntry(line: string): DebtEntry {
  const parsed = DebtEntrySchema.safeParse(JSON.parse(line))
  if (!parsed.success) return { ts: '', rule: 'unknown', evidenceDigest: '' }
  return parsed.data
}

async function readDebtLedger(ledgerPath: string): Promise<readonly DebtEntry[]> {
  try {
    const raw = await readFile(ledgerPath, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => parseDebtEntry(line))
  } catch {
    return []
  }
}

function hashOf(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return String(hash)
}
