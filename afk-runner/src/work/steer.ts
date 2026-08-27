// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

/**
 * Pre-settle steer precedence (D3 step 0): immediately before any
 * auto-settle, check both the raw `steer.md` and the persisted staged set —
 * a queued `abort` or `veto` that arrived (at the last round boundary or
 * directly) takes precedence over the pending auto-decision.
 */
export function pendingSteerOverride(runDir: string): boolean {
  const steerPath = path.join(runDir, 'steer.md')
  try {
    const staged = readFileSync(path.join(runDir, 'steer.staged.json'), 'utf8')
    const parsed = StagedSteerSchema.safeParse(JSON.parse(staged))
    if (parsed.success) {
      return parsed.data.directives.some((d) => d.kind === 'abort' || d.kind === 'veto')
    }
  } catch {
    /* no staged set */
  }
  try {
    const raw = readFileSync(steerPath, 'utf8')
    return parseSteerDirectives(raw).valid.some((d) => d.kind === 'abort' || d.kind === 'veto')
  } catch {
    return false
  }
}

/**
 * Clear the staged set when its target gate settles (or a veto is orphaned
 * by an earlier auto-decision) — D6. The file stays (append-only posture)
 * but carries an empty directive set.
 */
export function clearStagedSteer(runDir: string): void {
  writeFileSync(path.join(runDir, 'steer.staged.json'), `${JSON.stringify({ directives: [] })}\n`)
}

/** Queued steering grammar (D6): `extend`, `veto <id>=<redirect>`, `abort`. */
export type SteerDirective =
  | { readonly kind: 'extend' }
  | { readonly kind: 'veto'; readonly id: string; readonly redirect?: string }
  | { readonly kind: 'abort' }

export interface ParsedSteer {
  readonly valid: readonly SteerDirective[]
  readonly warnings: readonly string[]
}

/**
 * Parse `steer.md` content line by line against the fixed grammar. Unknown
 * directives (and, when `knownIds` is given, unknown veto ids) surface as
 * warn lines and are skipped — never fatal, never an `events.ndjson`
 * variant. Directive text is never interpolated into shell commands, file
 * paths, or prompts: each line maps to the closed `SteerDirective` union.
 */
export function parseSteerDirectives(
  content: string,
  options: { readonly knownIds?: ReadonlySet<string> } = {},
): ParsedSteer {
  const valid: SteerDirective[] = []
  const warnings: string[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line === 'extend') {
      valid.push({ kind: 'extend' })
      continue
    }
    if (line === 'abort') {
      valid.push({ kind: 'abort' })
      continue
    }
    const vetoMatch = line.match(/^veto\s+(\S+)=(.*)$/u)
    if (vetoMatch !== null) {
      const id = vetoMatch[1] ?? ''
      if (options.knownIds !== undefined && !options.knownIds.has(id)) {
        warnings.push(`unknown veto id: ${id}`)
        continue
      }
      const redirect = vetoMatch[2] ?? ''
      valid.push(redirect === '' ? { kind: 'veto', id } : { kind: 'veto', id, redirect })
      continue
    }
    warnings.push(`unknown directive: ${line}`)
  }
  return { valid, warnings }
}

/** Build the standard steering seam for a run state (D6). */
export const StagedSteerSchema = z.object({
  directives: z.array(
    z.union([
      z.object({ kind: z.literal('extend') }),
      z.object({ kind: z.literal('abort') }),
      z.object({ kind: z.literal('veto'), id: z.string().min(1), redirect: z.string().optional() }),
    ]),
  ),
})
export type StagedSteer = z.infer<typeof StagedSteerSchema>

function nextConsumedName(runDir: string): string {
  let n = 1
  while (existsSync(path.join(runDir, `steer.consumed.${n}.md`))) n += 1
  return `steer.consumed.${n}.md`
}

/**
 * Round-boundary consumption (D6): read `steer.md` if present, persist the
 * staged set to `steer.staged.json` BEFORE the rename (a crash mid-tick
 * re-consumes idempotently — the staged set survives), then rename to
 * `steer.consumed.<n>.md` (append-only audit; never delete).
 */
export function consumeSteerFile(runDir: string): ParsedSteer {
  const steerPath = path.join(runDir, 'steer.md')
  if (!existsSync(steerPath)) return { valid: [], warnings: [] }
  const parsed = parseSteerDirectives(readFileSync(steerPath, 'utf8'))
  const staged: StagedSteer = { directives: [...parsed.valid] }
  writeFileSync(path.join(runDir, 'steer.staged.json'), `${JSON.stringify(staged)}\n`)
  renameSync(steerPath, path.join(runDir, nextConsumedName(runDir)))
  return parsed
}

/** Reload the persisted staged set (resume-after-crash; missing file = none). */
export async function reloadStagedSteer(runDir: string): Promise<StagedSteer> {
  try {
    const raw = await readFile(path.join(runDir, 'steer.staged.json'), 'utf8')
    return StagedSteerSchema.parse(JSON.parse(raw))
  } catch {
    return { directives: [] }
  }
}
