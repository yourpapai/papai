// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir } from 'node:fs/promises'

import { parseFindings, renderBacklog, resolveHeaderYear, type SectionReview } from './ux-backlog-lib.js'

const REVIEW_DIR = 'docs/ux-reviews'
const OUTPUT_PATH = `${REVIEW_DIR}/_BACKLOG.md`

/**
 * Review documents only: `RUBRIC.md` is reference material, and every underscore-prefixed
 * file (`_TEMPLATE.md`, `_BACKLOG.md`, a future `_consistency.md`) is not a section review.
 */
export function isReviewDocument(name: string): boolean {
  return name.endsWith('.md') && !name.startsWith('_') && name !== 'RUBRIC.md'
}

export async function collectReviews(): Promise<SectionReview[]> {
  const names = (await readdir(REVIEW_DIR)).filter(isReviewDocument).sort()
  return Promise.all(names.map(async (name) => parseFindings(await Bun.file(`${REVIEW_DIR}/${name}`).text(), name)))
}

async function main(): Promise<void> {
  const reviews = await collectReviews()
  await Bun.write(OUTPUT_PATH, renderBacklog(reviews, resolveHeaderYear()))
  const findings = reviews.reduce((sum, review) => sum + review.findings.length, 0)
  console.log(`wrote ${OUTPUT_PATH} (${reviews.length} sections, ${findings} findings)`)
}

// Guard the entry point so the currency test can import `collectReviews` without the
// import itself regenerating the backlog and exiting the test process.
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
