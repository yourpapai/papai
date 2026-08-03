// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { classifyHybrid, classifyMetadata, classifyToolTrace } from './classifiers.js'
import { readCorpus } from './corpus-generator.js'
import type { CorpusLanguage, IntentCorpusRow } from './corpus-types.js'
import { evaluatedStrategy } from './evaluation-metrics.js'
import type { EvaluatedStrategy, EvaluationReport, SmallModelEvidence } from './evaluation-types.js'

interface EvaluationOptions {
  readonly latencyIterations?: number
}

interface EvaluationCli {
  readonly corpusPath: string
  readonly outputPath: string
}

function countLanguage(rows: readonly IntentCorpusRow[]): Record<CorpusLanguage, number> {
  const counts: Record<CorpusLanguage, number> = { en: 0, mixed: 0, ru: 0 }
  for (const row of rows) counts[row.language] += 1
  return counts
}

function smallModelEvidence(): SmallModelEvidence {
  return {
    execution_status: 'NOT_EXECUTED',
    qualification_status: 'NOT_QUALIFIED',
    reason_codes: [
      'NO_APPROVED_PROCESSOR_ENDPOINT',
      'NO_APPROVED_API_KEY',
      'NO_APPROVED_MODEL',
      'NO_COST_OR_LATENCY_EVIDENCE',
    ],
    calls: 0,
    measurements: {
      tokens: null,
      cost_usd_per_1000_turns: null,
      worker_p50_ms: null,
      worker_p95_ms: null,
      label_ready_p95_ms: null,
      user_visible_added_latency_ms: 0,
      persisted_classifier_input_output_content_count: 0,
    },
  }
}

function recommendation(hybrid: EvaluatedStrategy): EvaluationReport['recommendation'] {
  if (hybrid.thresholds.all_passed) {
    return {
      selected: 'hybrid_v1_without_small_model',
      decision: 'ADVANCE_DETERMINISTIC_A_PLUS_B',
      scope: 'synthetic_research_candidate_only',
      small_model: 'KEEP_OFF',
      production_qualification: 'PENDING_INDEPENDENT_HUMAN_ADJUDICATION_AND_OPT_IN_VALIDATION',
      rationale:
        'A+B met every numeric threshold on the sealed synthetic split with zero text egress and zero reply-path latency; C has no approved execution evidence.',
    }
  }
  return {
    selected: 'none',
    decision: 'DO_NOT_SHIP_CLASSIFIER',
    scope: 'synthetic_research_candidate_only',
    small_model: 'KEEP_OFF',
    production_qualification: 'PENDING_INDEPENDENT_HUMAN_ADJUDICATION_AND_OPT_IN_VALIDATION',
    rationale: 'A+B missed one or more binding thresholds, and C has no approved execution evidence.',
  }
}

export function evaluateCorpus(rows: readonly IntentCorpusRow[], options: EvaluationOptions = {}): EvaluationReport {
  const sealedTest = rows.filter(({ split }) => split === 'test')
  if (rows.length !== 3_000) throw new Error(`Expected 3,000 corpus rows, got ${rows.length}`)
  if (sealedTest.length !== 600) {
    throw new Error(`Expected 600 sealed-test rows, got ${sealedTest.length}`)
  }
  const latencyIterations = options.latencyIterations ?? 25
  const toolTrace = evaluatedStrategy(sealedTest, classifyToolTrace, latencyIterations)
  const metadata = evaluatedStrategy(sealedTest, classifyMetadata, latencyIterations)
  const hybrid = evaluatedStrategy(sealedTest, classifyHybrid, latencyIterations)
  return {
    schema: 'papai.intent.evaluation.v1',
    spdx: 'BUSL-1.1',
    taxonomy: 'intent.v1',
    corpus: { examples: rows.length, synthetic_only: true, production_messages: 0 },
    sealed_test: {
      examples: sealedTest.length,
      scenario_families: new Set(sealedTest.map(({ scenario_family_id }) => scenario_family_id)).size,
      languages: countLanguage(sealedTest),
      reuse_policy: 'rerun_for_reproducibility_only; never tune rules on this split',
    },
    strategies: {
      tool_trace_v1: toolTrace,
      metadata_v1: metadata,
      hybrid_v1: hybrid,
      small_model_v1: smallModelEvidence(),
    },
    recommendation: recommendation(hybrid),
  }
}

function parseCli(args: readonly string[]): EvaluationCli | undefined {
  if (args.length === 0) {
    return {
      corpusPath: path.join(import.meta.dir, 'intent-v1-corpus.jsonl'),
      outputPath: path.join(import.meta.dir, 'evaluation-results.json'),
    }
  }
  if (
    args.length === 4 &&
    args[0] === '--corpus' &&
    args[1] !== undefined &&
    args[2] === '--output' &&
    args[3] !== undefined
  ) {
    return { corpusPath: args[1], outputPath: args[3] }
  }
  return undefined
}

if (import.meta.main) {
  const cli = parseCli(Bun.argv.slice(2))
  if (cli === undefined) {
    console.error('Usage: bun evaluate.ts [--corpus /path/corpus.jsonl --output /path/results.json]')
    process.exitCode = 1
  } else {
    const result = evaluateCorpus(await readCorpus(cli.corpusPath))
    await Bun.write(cli.outputPath, `${JSON.stringify(result, null, 2)}\n`)
    console.log(
      JSON.stringify({
        strategy: result.recommendation.selected,
        test_examples: result.sealed_test.examples,
        thresholds_passed: result.strategies.hybrid_v1.thresholds.all_passed,
      }),
    )
  }
}
