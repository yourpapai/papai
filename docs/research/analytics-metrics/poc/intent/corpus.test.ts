// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { generateCorpusArtifacts, readCorpus } from './corpus-generator.js'
import type { IntentCorpusRow } from './corpus-types.js'

function familiesAreSplitIsolated(rows: readonly IntentCorpusRow[]): boolean {
  const familySplits = new Map<string, Set<string>>()
  for (const row of rows) {
    const splits = familySplits.get(row.scenario_family_id) ?? new Set<string>()
    splits.add(row.split)
    familySplits.set(row.scenario_family_id, splits)
  }
  return familySplits.size === 300 && [...familySplits.values()].every((splits) => splits.size === 1)
}

function everySplitHasEveryLanguage(rows: readonly IntentCorpusRow[]): boolean {
  const splits = ['development', 'calibration', 'test'] as const
  const languages = ['en', 'ru', 'mixed'] as const
  return splits.every((split) =>
    languages.every((language) => rows.some((row) => row.split === split && row.language === language)),
  )
}

test('generates exactly 3,000 deterministic, family-isolated examples', async () => {
  const firstDirectory = await mkdtemp(path.join(tmpdir(), 'papai-intent-first-'))
  const secondDirectory = await mkdtemp(path.join(tmpdir(), 'papai-intent-second-'))

  try {
    const first = await generateCorpusArtifacts(firstDirectory)
    const second = await generateCorpusArtifacts(secondDirectory)
    const rows = await readCorpus(first.corpusPath)

    expect(rows).toHaveLength(3_000)
    expect(first.corpusSha256).toBe(second.corpusSha256)
    expect(first.manifest.corpus.examples).toBe(3_000)
    expect(first.manifest.corpus.sha256).toBe(first.corpusSha256)
    expect(first.manifest.corpus.languages).toEqual({ en: 1_350, mixed: 300, ru: 1_350 })
    expect(first.manifest.corpus.splits).toEqual({
      calibration: 600,
      development: 1_800,
      test: 600,
    })
    expect(first.manifest.corpus.cohorts).toEqual({
      adversarial_boundary: 200,
      canonical_core: 2_000,
      multi_goal: 300,
      no_action: 250,
      unknown: 250,
    })
    expect(everySplitHasEveryLanguage(rows)).toBe(true)
    expect(familiesAreSplitIsolated(rows)).toBe(true)
  } finally {
    await Promise.all([
      rm(firstDirectory, { force: true, recursive: true }),
      rm(secondDirectory, { force: true, recursive: true }),
    ])
  }
})
