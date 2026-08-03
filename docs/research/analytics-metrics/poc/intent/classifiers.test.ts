// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { classifyHybrid, classifyMetadata, classifyToolTrace } from './classifiers.js'
import { generateCorpusArtifacts, readCorpus } from './corpus-generator.js'
import type { IntentCorpusRow } from './corpus-types.js'
import { evaluateCorpus } from './evaluate.js'

interface GeneratedRows {
  readonly directory: string
  readonly rows: readonly IntentCorpusRow[]
}

async function generatedRows(prefix: string): Promise<GeneratedRows> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  const generated = await generateCorpusArtifacts(directory)
  return { directory, rows: await readCorpus(generated.corpusPath) }
}

function decisiveTaskCreate(rows: readonly IntentCorpusRow[]): IntentCorpusRow | undefined {
  return rows.find(
    (row) => row.gold_primary === 'task.create' && row.tool_trace.length === 1 && row.command_family === 'none',
  )
}

function ambiguousBoundary(rows: readonly IntentCorpusRow[]): IntentCorpusRow | undefined {
  return rows.find((row) => row.cohort === 'adversarial_boundary' && row.tool_trace.length > 1)
}

function helpCommand(rows: readonly IntentCorpusRow[]): IntentCorpusRow | undefined {
  return rows.find((row) => row.command_family === 'help')
}

test('tool trace accepts only unambiguous semantic evidence', async () => {
  const generated = await generatedRows('papai-intent-tool-trace-')
  try {
    const decisive = decisiveTaskCreate(generated.rows)
    const ambiguous = ambiguousBoundary(generated.rows)
    expect(decisive).toBeDefined()
    expect(ambiguous).toBeDefined()
    expect(classifyToolTrace(decisive!).primary).toBe('task.create')
    expect(classifyToolTrace(decisive!).abstained).toBe(false)
    expect(classifyToolTrace(ambiguous!).primary).toBe('unknown')
    expect(classifyToolTrace(ambiguous!).abstained).toBe(true)
  } finally {
    await rm(generated.directory, { force: true, recursive: true })
  }
})

test('metadata sees no message text and hybrid prioritizes tool evidence', async () => {
  const generated = await generatedRows('papai-intent-metadata-')
  try {
    const command = helpCommand(generated.rows)
    const tool = decisiveTaskCreate(generated.rows)
    expect(command).toBeDefined()
    expect(tool).toBeDefined()
    expect(classifyMetadata(command!).primary).toBe('help_context')
    expect(classifyMetadata({ ...command!, message: 'different invented text' }).primary).toBe('help_context')
    expect(classifyHybrid(tool!)).toEqual({
      ...classifyToolTrace(tool!),
      strategy: 'hybrid_v1',
    })
  } finally {
    await rm(generated.directory, { force: true, recursive: true })
  }
})

test('reports threshold metrics without claiming SMALL_MODEL evidence', async () => {
  const generated = await generatedRows('papai-intent-evaluation-')
  try {
    const report = evaluateCorpus(generated.rows, { latencyIterations: 1 })
    expect(report.corpus.examples).toBe(3_000)
    expect(report.sealed_test.examples).toBe(600)
    expect(report.strategies.tool_trace_v1.metrics.accepted_rule_precision).toBeGreaterThanOrEqual(0.97)
    expect(report.strategies.hybrid_v1.thresholds.primary_macro_f1.passed).toBe(true)
    expect(report.strategies.hybrid_v1.thresholds.core_label_floor.passed).toBe(true)
    expect(report.strategies.hybrid_v1.thresholds.multi_goal_micro_f1.passed).toBe(true)
    expect(report.strategies.small_model_v1.execution_status).toBe('NOT_EXECUTED')
    expect(report.strategies.small_model_v1.qualification_status).toBe('NOT_QUALIFIED')
  } finally {
    await rm(generated.directory, { force: true, recursive: true })
  }
})
