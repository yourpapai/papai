// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Change digest extracted from existing change artifacts. Rendered in the gate
 * MD so a human can answer "what is this change and what does it touch" without
 * opening proposal.md/design.md. WHAT/WHY/TOUCHES are extracted; RISKS/BLAST
 * are rendered as references to sections already present in the gate.
 */
export interface ChangeDigest {
  readonly what: string | null
  readonly why: string | null
  readonly touches: readonly string[] | null
  readonly hasTasks: boolean
}

export interface ExtractChangeDigestInput {
  readonly proposalMd: string
  readonly designMd: string
  readonly hasTasksMd: boolean
  readonly tasksDone?: number
  readonly tasksTotal?: number
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Return the trimmed body of an ATX `## <heading>` section, stopping at the next
 * heading of equal or higher rank (h1/h2). Returns null when the heading is
 * absent or its body is empty. Only ATX (`## Why`) headings are recognized;
 * setext (`Why\n===`) yields null.
 */
function sectionAfterH2(md: string, heading: string): string | null {
  const re = new RegExp(`^## ${escapeRegex(heading)}\\b[^\\n]*`, 'mu')
  const start = re.exec(md)
  if (start === null) return null
  const after = md.slice(start.index + start[0].length)
  const next = /^#{1,2} \w/imu.exec(after)
  const body = (next === null ? after : after.slice(0, next.index)).trim()
  return body === '' ? null : body
}

function firstSentences(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat === '') return ''
  const sentences = flat.match(/[^.!?]+[.!?]+/gu)
  if (sentences === null) return flat
  return sentences.slice(0, max).join('').trim()
}

function bulletsOf(section: string): string[] {
  const out: string[] = []
  for (const line of section.split('\n')) {
    const match = /^\s*[-*]\s+(.+?)\s*$/u.exec(line)
    if (match !== null) {
      const bullet = match[1]
      if (bullet !== undefined) out.push(bullet)
    }
  }
  return out
}

function formatTaskLine(done: number | undefined, total: number | undefined): string {
  if (done !== undefined && total !== undefined) return `tasks: ${done}/${total}`
  return 'tasks: ?/?'
}

export function extractChangeDigest(input: ExtractChangeDigestInput): ChangeDigest {
  const whyBody = sectionAfterH2(input.proposalMd, 'Why')
  const why = whyBody
  const what = whyBody === null ? null : firstSentences(whyBody, 2) || null
  const impactBody = sectionAfterH2(input.proposalMd, 'Impact')
  let touches: string[] | null = impactBody === null ? null : bulletsOf(impactBody)
  if (touches !== null && touches.length === 0) touches = null
  if (input.hasTasksMd) {
    const entry = formatTaskLine(input.tasksDone, input.tasksTotal)
    touches = touches === null ? [entry] : [...touches, entry]
  }
  return { what, why, touches, hasTasks: input.hasTasksMd }
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

function countTaskCheckboxes(tasksMd: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const line of tasksMd.split('\n')) {
    const checked = /^\s*- \[x\]/iu.test(line)
    const unchecked = /^\s*- \[ \]/iu.test(line)
    if (checked || unchecked) {
      total += 1
      if (checked) done += 1
    }
  }
  return { done, total }
}

/**
 * Build the change digest rendered in the gate MD by reading proposal.md /
 * design.md from the change dir and checking tasks.md existence (mode signal:
 * absent at the early gate, present at the final gate). Missing files degrade
 * to null fields rendered as placeholders.
 */
export async function readChangeDigest(changeDir: string): Promise<ChangeDigest> {
  const [proposalMd, designMd] = await Promise.all([
    readFileSafe(path.join(changeDir, 'proposal.md')),
    readFileSafe(path.join(changeDir, 'design.md')),
  ])
  const tasksPath = path.join(changeDir, 'tasks.md')
  const hasTasksMd = existsSync(tasksPath)
  let tasksDone: number | undefined
  let tasksTotal: number | undefined
  if (hasTasksMd) {
    const counts = countTaskCheckboxes(await readFileSafe(tasksPath))
    tasksDone = counts.done
    tasksTotal = counts.total
  }
  return extractChangeDigest({ proposalMd, designMd, hasTasksMd, tasksDone, tasksTotal })
}
